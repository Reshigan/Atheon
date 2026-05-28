/**
 * Env-driven config for the deployed-API verification suites.
 * Credentials are NEVER hardcoded — the seeded vantax users are provisioned
 * out-of-band, so real creds come from CI secrets / the runbook operator.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Set it before running the verification suite ` +
      `(see docs/runbooks/go-live.md).`,
    );
  }
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const CONFIG = {
  apiUrl: optionalEnv('VERIFY_API_URL', 'https://atheon-api.vantax.co.za'),
  appUrl: optionalEnv('VERIFY_APP_URL', 'https://atheon.vantax.co.za'),
  tenantSlug: optionalEnv('VERIFY_TENANT_SLUG', 'vantax'),
  get adminEmail() { return requireEnv('VERIFY_ADMIN_EMAIL'); },
  get adminPassword() { return requireEnv('VERIFY_ADMIN_PASSWORD'); },
  // Optional — only needed by the second-tenant isolation enhancement.
  superadminEmail: process.env.VERIFY_SUPERADMIN_EMAIL?.trim() || '',
  superadminPassword: process.env.VERIFY_SUPERADMIN_PASSWORD?.trim() || '',
  d1DatabaseName: optionalEnv('VERIFY_D1_DB', 'atheon-db'),
} as const;
