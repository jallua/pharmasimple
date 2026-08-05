import { test, expect } from 'vitest';
import fc from 'fast-check';

// Trivial property to prove the vitest + fast-check toolchain runs.
// For all integers n, adding zero is the identity.
test('additive identity: for all integers n, n + 0 === n', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => {
      expect(n + 0).toBe(n);
    })
  );
});
