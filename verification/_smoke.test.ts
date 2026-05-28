import { describe, it, expect } from 'vitest';
import { CONFIG } from './config';

describe('verification harness bootstrap', () => {
  it('exposes a default API url', () => {
    expect(CONFIG.apiUrl).toMatch(/^https?:\/\//);
  });
  it('throws a clear error for a missing required credential', () => {
    const saved = process.env.VERIFY_ADMIN_EMAIL;
    delete process.env.VERIFY_ADMIN_EMAIL;
    expect(() => CONFIG.adminEmail).toThrow(/VERIFY_ADMIN_EMAIL/);
    if (saved) process.env.VERIFY_ADMIN_EMAIL = saved;
  });
});
