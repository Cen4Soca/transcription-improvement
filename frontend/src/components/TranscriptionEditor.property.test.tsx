import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import fc from 'fast-check';
import { TranscriptionEditor } from './TranscriptionEditor';

describe('Feature: transcription-review-app, Property 4: エラーメッセージへの理由の包含', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any error object with a message string, the rendered TranscriptionEditor
   * displays that message string in the output.
   */
  test('エラーオブジェクトのメッセージ文字列が表示される', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (errorMessage) => {
          const { container, unmount } = render(
            <TranscriptionEditor
              segments={[]}
              error={{ message: errorMessage }}
            />
          );

          expect(container.textContent).toContain(errorMessage);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
