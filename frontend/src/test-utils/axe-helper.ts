import { axe, configureAxe } from 'vitest-axe';
import type { AxeResults, RunOptions } from 'axe-core';

/**
 * Pre-configured axe instance for WCAG 2.1 AA compliance testing.
 *
 * Runs axe-core with WCAG 2.1 Level A and AA rules enabled.
 * Use this in component tests to verify accessibility compliance.
 *
 * @example
 * ```ts
 * import { render } from '@testing-library/react';
 * import { checkA11y } from '../test-utils/axe-helper';
 *
 * test('component has no accessibility violations', async () => {
 *   const { container } = render(<MyComponent />);
 *   await checkA11y(container);
 * });
 * ```
 */

/**
 * Configured axe runner targeting WCAG 2.1 AA standards.
 */
const axeWCAG21AA = configureAxe({
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
});

/**
 * Run axe-core accessibility checks on an HTML element.
 * Asserts that there are no WCAG 2.1 AA violations.
 *
 * @param container - The DOM element to test
 * @param options - Additional axe-core run options (optional)
 * @throws AssertionError if accessibility violations are found
 */
export async function checkA11y(
  container: Element,
  options?: RunOptions,
): Promise<void> {
  const results: AxeResults = await axeWCAG21AA(container, options);
  expect(results).toHaveNoViolations();
}

/**
 * Run axe-core and return raw results without asserting.
 * Useful when you need to inspect violations or filter results.
 *
 * @param container - The DOM element to test
 * @param options - Additional axe-core run options (optional)
 * @returns AxeResults object with violations, passes, etc.
 */
export async function getA11yResults(
  container: Element,
  options?: RunOptions,
): Promise<AxeResults> {
  return axeWCAG21AA(container, options);
}

/**
 * Run axe-core with default configuration (all rules).
 * Use this for broader accessibility checks beyond WCAG 2.1 AA.
 */
export { axe };
