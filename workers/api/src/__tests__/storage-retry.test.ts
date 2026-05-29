import { describe, it, expect } from 'vitest';
import { withStorageRetry } from '../services/storage-retry';

describe('withStorageRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    let calls = 0;
    const result = await withStorageRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a transient failure and resolves once the isolate is warm', async () => {
    let calls = 0;
    const result = await withStorageRetry(async () => {
      calls++;
      if (calls < 2) throw new Error('D1_ERROR: cold isolate');
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('throws the last error after exhausting all attempts', async () => {
    let calls = 0;
    await expect(
      withStorageRetry(async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });
});
