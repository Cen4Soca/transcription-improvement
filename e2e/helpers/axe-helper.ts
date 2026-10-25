import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Run an axe-core WCAG 2.1 AA scan on the current page and assert zero violations.
 *
 * Scopes the scan to WCAG 2.0/2.1 level A and AA rule tags (the project's target
 * per tech steering: WCAG 2.1 AA). On failure, the violation ids and affected
 * nodes are surfaced in the assertion message to make triage easy.
 *
 * @param page   The Playwright page to scan.
 * @param include Optional CSS selector to limit the scan (e.g. a specific region).
 */
export async function expectNoAxeViolations(
  page: Page,
  include?: string
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);
  if (include) {
    builder = builder.include(include);
  }
  const results = await builder.analyze();

  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
  }));

  expect(
    results.violations,
    `axe WCAG 2.1 AA 違反: ${JSON.stringify(summary, null, 2)}`
  ).toEqual([]);
}
