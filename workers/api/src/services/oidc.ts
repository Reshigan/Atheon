/**
 * Generic OIDC SSO support — Okta, Auth0, Google Workspace, Keycloak,
 * Microsoft Entra (any provider that publishes a standards-compliant
 * `.well-known/openid-configuration` discovery document).
 *
 * Why this exists: the existing /sso path handles Azure AD via hardcoded
 * URLs and skips ID-token signature verification. Both are problems for
 * the next deal — enterprise IdP teams won't accept a hardcoded provider
 * choice and definitely won't accept unverified ID tokens. This module
 * gives /sso/callback (auth.ts) a small surface to call:
 *
 *   - fetchDiscovery(issuerUrl)        — discovery doc, KV-cached 10 min
 *   - buildAuthorizeUrl(...)           — assembles the authorize redirect
 *   - exchangeCodeForTokens(...)       — code → {id_token, access_token}
 *   - verifyIdToken(idToken, ...)      — RS256 verify against JWKS
 *
 * Crypto: uses the Workers SubtleCrypto API. Only RS256 is supported
 * (covers >99% of real-world IdPs). HS256 is intentionally rejected —
 * it would require sharing a symmetric secret with the IdP, which no
 * enterprise IdP does.
 */

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
}

interface Jwk {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface Jwks {
  keys: Jwk[];
}

interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  nonce?: string;
}

const DISCOVERY_CACHE_TTL_S = 600;   // 10 min
const JWKS_CACHE_TTL_S = 600;        // 10 min

/** Fetch + cache the OIDC discovery document for an issuer. */
export async function fetchDiscovery(issuerUrl: string, cacheKv?: KVNamespace): Promise<DiscoveryDocument> {
  const normalized = issuerUrl.replace(/\/$/, '');
  const cacheKey = `oidc:discovery:${normalized}`;
  if (cacheKv) {
    const cached = await cacheKv.get(cacheKey);
    if (cached) return JSON.parse(cached) as DiscoveryDocument;
  }
  const url = `${normalized}/.well-known/openid-configuration`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`OIDC discovery failed for ${url}: HTTP ${res.status}`);
  const doc = await res.json() as DiscoveryDocument;
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error(`OIDC discovery doc missing required fields for ${url}`);
  }
  if (cacheKv) {
    await cacheKv.put(cacheKey, JSON.stringify(doc), { expirationTtl: DISCOVERY_CACHE_TTL_S });
  }
  return doc;
}

/** Build the IdP authorize URL from a discovery document. */
export function buildAuthorizeUrl(opts: {
  discovery: DiscoveryDocument;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  domainHint?: string | null;
  nonce?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    scope: opts.scope || 'openid profile email',
    state: opts.state,
  });
  if (opts.domainHint) {
    // login_hint is the OIDC-standard equivalent of Azure's domain_hint.
    params.set('login_hint', opts.domainHint);
  }
  if (opts.nonce) {
    // Replay protection: the IdP echoes this into the ID token's nonce claim,
    // which the callback verifies against the value bound into the signed state.
    params.set('nonce', opts.nonce);
  }
  return `${opts.discovery.authorization_endpoint}?${params.toString()}`;
}

/** Exchange an authorization code for {id_token, access_token, ...}. */
export async function exchangeCodeForTokens(opts: {
  discovery: DiscoveryDocument;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ id_token: string; access_token?: string; refresh_token?: string }> {
  const res = await fetch(opts.discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OIDC token exchange failed: HTTP ${res.status} ${text.slice(0, 256)}`);
  }
  const body = await res.json() as { id_token?: string; access_token?: string; refresh_token?: string };
  if (!body.id_token) throw new Error('OIDC token endpoint returned no id_token');
  return { id_token: body.id_token, access_token: body.access_token, refresh_token: body.refresh_token };
}

// ── JWT verify helpers ───────────────────────────────────────────────────

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64url.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(part))) as T;
}

async function fetchJwks(jwksUri: string, cacheKv?: KVNamespace): Promise<Jwks> {
  const cacheKey = `oidc:jwks:${jwksUri}`;
  if (cacheKv) {
    const cached = await cacheKv.get(cacheKey);
    if (cached) return JSON.parse(cached) as Jwks;
  }
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const jwks = await res.json() as Jwks;
  if (cacheKv) {
    await cacheKv.put(cacheKey, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL_S });
  }
  return jwks;
}

/**
 * Verify an OIDC ID token: signature (RS256), issuer, audience, expiry.
 * Returns the parsed claims on success, throws on any failure.
 */
export async function verifyIdToken(opts: {
  idToken: string;
  discovery: DiscoveryDocument;
  expectedAudience: string;
  expectedNonce?: string;
  cacheKv?: KVNamespace;
  clockSkewSeconds?: number;
}): Promise<IdTokenClaims> {
  const parts = opts.idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT: expected 3 parts');
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeJwtPart<{ alg: string; kid?: string; typ?: string }>(headerB64);
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT alg: ${header.alg} (only RS256 accepted)`);
  }
  const claims = decodeJwtPart<IdTokenClaims>(payloadB64);

  // Issuer match — discovery.issuer is the canonical value.
  if (claims.iss !== opts.discovery.issuer) {
    throw new Error(`ID token issuer mismatch: expected ${opts.discovery.issuer}, got ${claims.iss}`);
  }
  // Audience match — IdPs may return aud as string or array.
  const audMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(opts.expectedAudience)
    : claims.aud === opts.expectedAudience;
  if (!audMatches) {
    throw new Error(`ID token audience mismatch: expected ${opts.expectedAudience}, got ${claims.aud}`);
  }
  // Expiry with optional clock skew tolerance.
  const skew = opts.clockSkewSeconds ?? 60;
  const nowS = Math.floor(Date.now() / 1000);
  if (claims.exp + skew < nowS) {
    throw new Error(`ID token expired at ${claims.exp}, now ${nowS}`);
  }
  // Nonce match — when the caller bound a nonce into the authorize request,
  // the ID token must echo exactly that value (replay/injection protection).
  if (opts.expectedNonce !== undefined && claims.nonce !== opts.expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }

  // Signature verify against the JWK whose kid matches the header's kid.
  const jwks = await fetchJwks(opts.discovery.jwks_uri, opts.cacheKv);
  const jwk = jwks.keys.find(k => k.kid === header.kid && (k.alg ?? 'RS256') === 'RS256') || jwks.keys[0];
  if (!jwk) throw new Error('No matching JWK found in JWKS');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      ext: true,
    } as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature as BufferSource,
    signedData as BufferSource,
  );
  if (!valid) throw new Error('ID token signature verification failed');

  return claims;
}

/** Test-only: expose the JWT decode helper for assertion fixtures. */
export const _testExports = { decodeJwtPart, base64UrlToUint8Array };
