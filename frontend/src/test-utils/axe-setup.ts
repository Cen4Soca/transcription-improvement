/**
 * axe-setup.ts - Accessibility test configuration for vitest-axe
 *
 * Provides pre-configured axe-core utilities for WCAG 2.1 AA compliance testing.
 * Import `checkA11y` in component tests to assert no accessibility violations.
 *
 * @example
 * ```ts
 * import { render } from '@testing-library/react';
 * import { checkA11y, checkA11yWithOptions } from '../test-utils/axe-setup';
 *
 * test('component is accessible', async () => {
 *   const { container } = render(<MyComponent />);
 *   await checkA11y(container);
 * });
 * ```
 */

import { configureAxe } from 'vitest-axe';
import type { AxeResults, RunOptions, Spec } from 'axe-core';

/**
 * WCAG 2.1 AA configured axe runner.
 * Runs only WCAG 2.1 Level A and AA rules.
 */
const wcag21AAAxe = configureAxe({
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
});

/**
 * Run axe-core WCAG 2.1 AA checks and assert no violations.
 *
 * @param container - The DOM element to test
 * @param options - Additional axe-core run options (optional)
 * @throws AssertionError if accessibility violations are found
 */
export async function checkA11y(
  container: Element,
  options?: RunOptions,
): Promise<void> {
  const results: AxeResults = await wcag21AAAxe(container, options);
  expect(results).toHaveNoViolations();
}

/**
 * Run axe-core with custom configuration and assert no violations.
 * Useful when you need to disable specific rules for known exceptions.
 *
 * @param container - The DOM element to test
 * @param disabledRules - Array of rule IDs to disable
 * @param options - Additional axe-core run options (optional)
 */
export async function checkA11yWithOptions(
  container: Element,
  disabledRules: string[] = [],
  options?: RunOptions,
): Promise<void> {
  const rules: Record<string, Spec> = {};
  for (const ruleId of disabledRules) {
    rules[ruleId] = { enabled: false };
  }

  const customAxe = configureAxe({
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
    rules,
  });

  const results: AxeResults = await customAxe(container, options);
  expect(results).toHaveNoViolations();
}

/**
 * Run axe-core and return raw results without asserting.
 * Useful for inspecting violations or filtering results.
 *
 * @param container - The DOM element to test
 * @param options - Additional axe-core run options (optional)
 * @returns AxeResults with violations, passes, incomplete, etc.
 */
export async function getA11yResults(
  container: Element,
  options?: RunOptions,
): Promise<AxeResults> {
  return wcag21AAAxe(container, options);
}

/**
 * Format axe violations into a readable string for debugging.
 */
export function formatViolations(results: AxeResults): string {
  if (results.violations.length === 0) return 'No violations found.';

  return results.violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.html}`)
        .join('\n');
      return `[${violation.id}] ${violation.description}\n  Impact: ${violation.impact}\n  Nodes:\n${nodes}`;
    })
    .join('\n\n');
}
