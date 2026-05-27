/**
 * RFC 6238 TOTP verification, edge-compatible (Web Crypto only).
 * 30-second step, ±1 step skew tolerance. Base32 secrets.
 *
 * Extracted from routes/auth.ts so step-up MFA middleware and any
 * future high-risk action handlers can re-verify a fresh code without
 * importing route code.
 */

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  if (!secret || !code || code.length !== 6) return false;

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const keyData = new Uint8Array(bytes);

  const now = Math.floor(Date.now() / 1000);
  const timeStep = 30;

  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor((now + offset * timeStep) / timeStep);
    const counterBytes = new ArrayBuffer(8);
    const view = new DataView(counterBytes);
    view.setUint32(4, counter, false);

    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const hmac = await crypto.subtle.sign('HMAC', key, counterBytes);
    const hmacBytes = new Uint8Array(hmac);

    const off = hmacBytes[hmacBytes.length - 1] & 0x0f;
    const binary =
      ((hmacBytes[off] & 0x7f) << 24) |
      ((hmacBytes[off + 1] & 0xff) << 16) |
      ((hmacBytes[off + 2] & 0xff) << 8) |
      (hmacBytes[off + 3] & 0xff);
    const otp = (binary % 1000000).toString().padStart(6, '0');

    if (otp === code) return true;
  }
  return false;
}
