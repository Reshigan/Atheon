/**
 * OIDC service tests — discovery doc fetch + RS256 ID token verification.
 *
 * These run in the workerd test environment so SubtleCrypto is available
 * for the RSA verify path. The IdP HTTP surface (discovery doc, JWKS) is
 * mocked by intercepting global fetch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchDiscovery, buildAuthorizeUrl, verifyIdToken, _testExports } from '../services/oidc';

// ── Test fixtures ────────────────────────────────────────────────────────

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

interface SignedToken {
  token: string;
  jwk: JsonWebKey;
  kid: string;
}

/** Generate an RSA-2048 key pair and sign an ID token with the given claims. */
async function signTestIdToken(claims: Record<string, unknown>, kid = 'test-kid-1'): Promise<SignedToken> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = jsonToBase64Url(header);
  const payloadB64 = jsonToBase64Url(claims);
  const signed = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signed) as BufferSource,
  );
  const sigB64 = bytesToBase64Url(signature);
  return { token: `${signed}.${sigB64}`, jwk: publicJwk, kid };
}

const ISSUER = 'https://test-idp.example.com';
const CLIENT_ID = 'test-client-id';

const DISCOVERY_DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
};

let originalFetch: typeof fetch;
let mockResponses: Record<string, unknown> = {};

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockResponses = {};
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void init; // mock fetch ignores init; declared so the signature matches
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = mockResponses[url];
    if (body === undefined) {
      throw new Error(`Unexpected fetch in test: ${url}`);
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('OIDC discovery', () => {
  it('fetches and validates a well-formed discovery document', async () => {
    mockResponses[`${ISSUER}/.well-known/openid-configuration`] = DISCOVERY_DOC;
    const doc = await fetchDiscovery(ISSUER);
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.authorization_endpoint).toContain('/oauth2/authorize');
  });

  it('rejects a discovery document missing required fields', async () => {
    mockResponses[`${ISSUER}/.well-known/openid-configuration`] = { issuer: ISSUER }; // missing endpoints
    await expect(fetchDiscovery(ISSUER)).rejects.toThrow(/missing required/);
  });

  it('strips trailing slash from issuer URL before appending discovery path', async () => {
    mockResponses[`${ISSUER}/.well-known/openid-configuration`] = DISCOVERY_DOC;
    const doc = await fetchDiscovery(`${ISSUER}/`);
    expect(doc.issuer).toBe(ISSUER);
  });
});

describe('OIDC buildAuthorizeUrl', () => {
  it('assembles the authorize redirect with required params', () => {
    const url = buildAuthorizeUrl({
      discovery: DISCOVERY_DOC,
      clientId: CLIENT_ID,
      redirectUri: 'https://atheon.example.com/login',
      state: 'state-123',
    });
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=openid+profile+email');
    expect(url).toContain('state=state-123');
  });

  it('includes login_hint when domain hint is provided', () => {
    const url = buildAuthorizeUrl({
      discovery: DISCOVERY_DOC,
      clientId: CLIENT_ID,
      redirectUri: 'https://atheon.example.com/login',
      state: 'state-123',
      domainHint: 'acme.com',
    });
    expect(url).toContain('login_hint=acme.com');
  });

  it('includes nonce when provided', () => {
    const url = buildAuthorizeUrl({
      discovery: DISCOVERY_DOC,
      clientId: CLIENT_ID,
      redirectUri: 'https://atheon.example.com/login',
      state: 'state-123',
      nonce: 'nonce-abc',
    });
    expect(url).toContain('nonce=nonce-abc');
  });

  it('omits nonce when not provided', () => {
    const url = buildAuthorizeUrl({
      discovery: DISCOVERY_DOC,
      clientId: CLIENT_ID,
      redirectUri: 'https://atheon.example.com/login',
      state: 'state-123',
    });
    expect(url).not.toContain('nonce=');
  });
});

describe('OIDC verifyIdToken', () => {
  const baseClaims = (overrides: Partial<Record<string, unknown>> = {}) => ({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    email: 'alice@example.com',
    name: 'Alice',
    ...overrides,
  });

  it('verifies a well-formed RS256 ID token', async () => {
    const signed = await signTestIdToken(baseClaims());
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    const claims = await verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    });
    expect(claims.email).toBe('alice@example.com');
    expect(claims.sub).toBe('user-1');
  });

  it('rejects token with wrong issuer', async () => {
    const signed = await signTestIdToken(baseClaims({ iss: 'https://malicious.example.com' }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    await expect(verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    })).rejects.toThrow(/issuer mismatch/);
  });

  it('rejects token with wrong audience', async () => {
    const signed = await signTestIdToken(baseClaims({ aud: 'wrong-client-id' }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    await expect(verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    })).rejects.toThrow(/audience mismatch/);
  });

  it('accepts audience array containing the expected client id', async () => {
    const signed = await signTestIdToken(baseClaims({ aud: ['other-client', CLIENT_ID] }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    const claims = await verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    });
    expect(Array.isArray(claims.aud)).toBe(true);
  });

  it('rejects an expired token (beyond clock skew)', async () => {
    const signed = await signTestIdToken(baseClaims({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    await expect(verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
      clockSkewSeconds: 60,
    })).rejects.toThrow(/expired/);
  });

  it('rejects unsupported signing algorithms (HS256)', async () => {
    // HS256 token (manually constructed — we don't generate one). Header
    // says HS256, signature is bogus; the verifier should reject before
    // attempting the signature check.
    const header = { alg: 'HS256', typ: 'JWT', kid: 'k' };
    const claims = baseClaims();
    const token = `${jsonToBase64Url(header)}.${jsonToBase64Url(claims)}.bogussig`;
    await expect(verifyIdToken({
      idToken: token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    })).rejects.toThrow(/Unsupported JWT alg/);
  });

  it('rejects token with tampered payload', async () => {
    const signed = await signTestIdToken(baseClaims());
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    // Re-encode the payload after modifying email — leaving signature intact.
    const parts = signed.token.split('.');
    const tamperedPayload = jsonToBase64Url({ ...baseClaims(), email: 'attacker@evil.com' });
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    await expect(verifyIdToken({
      idToken: tampered,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
    })).rejects.toThrow(/signature verification failed/);
  });

  it('accepts a token whose nonce matches the expected nonce', async () => {
    const signed = await signTestIdToken(baseClaims({ nonce: 'expected-nonce' }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    const claims = await verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
      expectedNonce: 'expected-nonce',
    });
    expect(claims.nonce).toBe('expected-nonce');
  });

  it('rejects a token whose nonce does not match (replay/injection)', async () => {
    const signed = await signTestIdToken(baseClaims({ nonce: 'attacker-nonce' }));
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    await expect(verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
      expectedNonce: 'expected-nonce',
    })).rejects.toThrow(/nonce mismatch/);
  });

  it('rejects a token missing the nonce claim when a nonce is expected', async () => {
    const signed = await signTestIdToken(baseClaims()); // no nonce
    mockResponses[DISCOVERY_DOC.jwks_uri] = { keys: [signed.jwk] };
    await expect(verifyIdToken({
      idToken: signed.token,
      discovery: DISCOVERY_DOC,
      expectedAudience: CLIENT_ID,
      expectedNonce: 'expected-nonce',
    })).rejects.toThrow(/nonce mismatch/);
  });
});

describe('OIDC test exports', () => {
  it('decodeJwtPart round-trips JSON', () => {
    const payload = { foo: 'bar', n: 42 };
    const b64 = jsonToBase64Url(payload);
    expect(_testExports.decodeJwtPart(b64)).toEqual(payload);
  });
});
