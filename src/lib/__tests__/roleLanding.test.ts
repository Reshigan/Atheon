/**
 * Role-aware landing helper.
 *
 * Locks the mapping to specific destinations so a refactor of the
 * sidebar role gating doesn't accidentally route someone to a page
 * they can't access. If a destination changes (e.g. operator moves
 * to /transactional-actions once #383 lands), update both
 * `roleLanding.ts` and this test together.
 */
import { describe, it, expect } from "vitest";
import { defaultLandingForRole } from "@/lib/roleLanding";
import type { UserRole } from "@/types";

describe("defaultLandingForRole", () => {
  const cases: Array<[UserRole, string]> = [
    ['superadmin',    '/support'],
    ['support_admin', '/support'],
    ['admin',         '/integrations'],
    ['executive',     '/apex'],
    ['manager',       '/pulse'],
    ['operator',      '/catalysts'],
    ['analyst',       '/mind'],
    ['viewer',        '/dashboard'],
  ];

  it.each(cases)('routes %s to %s', (role, expectedPath) => {
    expect(defaultLandingForRole(role)).toBe(expectedPath);
  });

  it('falls back to /dashboard for an unknown role', () => {
    // Cast through unknown so we exercise the default branch without
    // disabling type-checking elsewhere.
    expect(defaultLandingForRole('not-a-real-role' as unknown as UserRole)).toBe('/dashboard');
  });

  it('covers every UserRole exhaustively', () => {
    const expectedRoles: UserRole[] = [
      'superadmin', 'support_admin', 'admin', 'executive',
      'manager', 'analyst', 'operator', 'viewer',
    ];
    const covered = cases.map(([role]) => role);
    expect(new Set(covered)).toEqual(new Set(expectedRoles));
  });
});
