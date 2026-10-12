import { describe, test, expect } from 'vitest';
import { checkA11y, checkA11yWithOptions, getA11yResults, formatViolations } from './axe-setup';

describe('axe-setup', () => {
  test('checkA11y passes for accessible HTML', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <main aria-label="テスト">
        <h1>テストページ</h1>
        <button type="button">クリック</button>
      </main>
    `;
    document.body.appendChild(container);

    await checkA11y(container);

    document.body.removeChild(container);
  });

  test('checkA11y detects violations for inaccessible HTML', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<img src="test.png" />`;
    document.body.appendChild(container);

    const results = await getA11yResults(container);
    expect(results.violations.length).toBeGreaterThan(0);

    document.body.removeChild(container);
  });

  test('checkA11yWithOptions can disable specific rules', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<img src="test.png" />`;
    document.body.appendChild(container);

    // Should pass when image-alt rule is disabled
    await checkA11yWithOptions(container, ['image-alt']);

    document.body.removeChild(container);
  });

  test('formatViolations returns readable string', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<img src="test.png" />`;
    document.body.appendChild(container);

    const results = await getA11yResults(container);
    const formatted = formatViolations(results);
    expect(formatted).toContain('image-alt');

    document.body.removeChild(container);
  });

  test('formatViolations returns no violations message for clean HTML', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<main aria-label="テスト"><h1>見出し</h1></main>`;
    document.body.appendChild(container);

    const results = await getA11yResults(container);
    const formatted = formatViolations(results);
    expect(formatted).toBe('No violations found.');

    document.body.removeChild(container);
  });
});
