/**
 * Roadmap C5 — APM service tests.
 *
 * The service is fire-and-forget by contract — it must never throw on the
 * request path. These tests pin:
 *   - path bucketing (UUID + numeric ID collapsing, segment cap)
 *   - status class mapping
 *   - the writeDataPoint payload shape (the dashboard SQL queries assume
 *     index1/blob1..3/double1..2 in a specific order)
 *   - no-op when env.APM is undefined
 *   - never throws when writeDataPoint itself throws
 */
import { describe, it, expect, vi } from 'vitest';
import { bucketPath, statusClass, recordRequest } from '../services/apm';

describe('bucketPath', () => {
  it('strips query string', () => {
    expect(bucketPath('/api/users?id=1')).toBe('/api/users');
  });

  it('collapses UUIDs to :id', () => {
    expect(bucketPath('/api/tenants/abc12345-6789-4abc-def0-1234567890ab/users'))
      .toBe('/api/tenants/:id/users');
  });

  it('collapses long numeric IDs to :id', () => {
    expect(bucketPath('/api/orders/12345/items')).toBe('/api/orders/:id/items');
  });

  it('keeps short numeric segments (likely API versions)', () => {
    expect(bucketPath('/api/v1/pulse')).toBe('/api/v1/pulse');
  });

  it('caps to first 4 segments', () => {
    expect(bucketPath('/a/b/c/d/e/f/g')).toBe('/a/b/c/d');
  });

  it('handles root', () => {
    expect(bucketPath('/')).toBe('/');
  });
});

describe('statusClass', () => {
  it.each([
    [200, '2xx'],
    [299, '2xx'],
    [301, '3xx'],
    [404, '4xx'],
    [503, '5xx'],
    [100, 'other'],
    [600, 'other'],
  ] as const)('status %i -> %s', (s, expected) => {
    expect(statusClass(s)).toBe(expected);
  });
});

describe('recordRequest', () => {
  it('writes a data point with the expected shape', () => {
    const writeDataPoint = vi.fn();
    recordRequest({ APM: { writeDataPoint } } as never, {
      method: 'GET',
      path: '/api/pulse/anomalies/abc12345-6789-4abc-def0-1234567890ab',
      status: 200,
      durationMs: 142,
      requestId: 'req-xyz',
      tenantId: 'tenant-1',
    });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const dp = writeDataPoint.mock.calls[0][0];
    expect(dp.indexes).toEqual(['GET /api/pulse/anomalies/:id']);
    expect(dp.blobs).toEqual(['req-xyz', 'tenant-1', '2xx']);
    expect(dp.doubles).toEqual([142, 0]); // 0 = not slow
  });

  it('flags slow requests with doubles[1] = 1', () => {
    const writeDataPoint = vi.fn();
    recordRequest({ APM: { writeDataPoint } } as never, {
      method: 'POST',
      path: '/api/catalysts/run',
      status: 200,
      durationMs: 800,
    });
    expect(writeDataPoint.mock.calls[0][0].doubles).toEqual([800, 1]);
  });

  it('substitutes empty strings for missing requestId/tenantId', () => {
    const writeDataPoint = vi.fn();
    recordRequest({ APM: { writeDataPoint } } as never, {
      method: 'GET', path: '/healthz', status: 200, durationMs: 5,
    });
    expect(writeDataPoint.mock.calls[0][0].blobs).toEqual(['', '', '2xx']);
  });

  it('is a no-op when env.APM is undefined', () => {
    // Should not throw, should not do anything observable.
    expect(() => recordRequest({} as never, {
      method: 'GET', path: '/api/x', status: 200, durationMs: 10,
    })).not.toThrow();
  });

  it('swallows writeDataPoint failures (must never propagate)', () => {
    const writeDataPoint = vi.fn(() => { throw new Error('AE quota'); });
    expect(() => recordRequest({ APM: { writeDataPoint } } as never, {
      method: 'GET', path: '/api/x', status: 500, durationMs: 50,
    })).not.toThrow();
  });
});
