import { describe, test, expect } from 'vitest';
import { checkA11y, getA11yResults } from './axe-helper';

describe('axe-helper', () => {
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
    container.innerHTML = `
      <img src="test.png" />
    `;
    document.body.appendChild(container);

    const results = await getA11yResults(container);
    expect(results.violations.length).toBeGreaterThan(0);

    const imageViolation = results.violations.find(
      (v) => v.id === 'image-alt',
    );
    expect(imageViolation).toBeDefined();

    document.body.removeChild(container);
  });

  test('getA11yResults returns structured results', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <main aria-label="テスト">
        <h1>見出し</h1>
        <p>段落テキスト</p>
      </main>
    `;
    document.body.appendChild(container);

    const results = await getA11yResults(container);
    expect(results).toHaveProperty('violations');
    expect(results).toHaveProperty('passes');
    expect(results).toHaveProperty('incomplete');
    expect(Array.isArray(results.violations)).toBe(true);

    document.body.removeChild(container);
  });
});
