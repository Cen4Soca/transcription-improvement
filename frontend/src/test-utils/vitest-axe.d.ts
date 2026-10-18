import 'vitest';
import type { AxeMatchers } from 'vitest-axe';

declare module 'vitest' {
  // Augment vitest's matcher interfaces with vitest-axe matchers (e.g.
  // `toHaveNoViolations`). An empty interface body is required here: this is a
  // pure declaration-merging augmentation that only widens the existing vitest
  // interfaces via `extends`, so there are no members of our own to declare.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
