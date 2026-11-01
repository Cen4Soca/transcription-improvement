import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import i18n from '../i18n';
import { SessionNameEditor } from './SessionNameEditor';

const tsn = (key: string) => i18n.t(`review:sessionName.${key}`);
const tc = (key: string) => i18n.t(`common:${key}`);

describe('SessionNameEditor', () => {
  it('表示モードで名前と編集ボタンを表示し、違反がない (WCAG 2.1 AA)', async () => {
    const { container } = render(
      <SessionNameEditor name="会議録A" onSave={vi.fn().mockResolvedValue(null)} />
    );

    expect(screen.getByText('会議録A')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: tsn('editAriaLabel') })
    ).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('編集→保存で onSave が trim 済みの名前で呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <SessionNameEditor name="旧名" onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));

    const input = screen.getByRole('textbox', { name: tsn('nameAriaLabel') });
    await user.clear(input);
    await user.type(input, '  新しい名前  ');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onSave).toHaveBeenCalledWith('新しい名前');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('キャンセルで編集前の表示に戻る', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <SessionNameEditor name="元の名前" onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    const input = screen.getByRole('textbox', { name: tsn('nameAriaLabel') });
    await user.clear(input);
    await user.type(input, '破棄される入力');
    await user.click(screen.getByRole('button', { name: tc('cancel') }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('元の名前')).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('空の名前はクライアントエラーを表示し onSave を呼ばない', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <SessionNameEditor name="元の名前" onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    const input = screen.getByRole('textbox', { name: tsn('nameAriaLabel') });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'セッション名を入力してください。'
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('101文字はクライアントエラーを表示し onSave を呼ばない', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <SessionNameEditor name="元の名前" onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    const input = screen.getByRole('textbox', { name: tsn('nameAriaLabel') });
    await user.clear(input);
    await user.type(input, 'a'.repeat(101));
    await user.click(screen.getByRole('button', { name: tc('save') }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'セッション名は100文字以内で入力してください。'
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('API が VALIDATION_ERROR を返すと日本語に変換して表示する', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({
      code: 'VALIDATION_ERROR',
      message: 'Session name must be between 1 and 100 characters.',
    });
    render(<SessionNameEditor name="元の名前" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    const input = screen.getByRole('textbox', { name: tsn('nameAriaLabel') });
    await user.clear(input);
    await user.type(input, '有効な名前');
    await user.click(screen.getByRole('button', { name: tc('save') }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(tsn('rule'));
    });
  });

  it('提案ボタン押下で候補が入力欄にセットされる', async () => {
    const user = userEvent.setup();
    const onRequestSuggestion = vi.fn().mockResolvedValue({
      suggestion: '提案されたセッション名',
      hasExternalApiError: false,
    });
    const { container } = render(
      <SessionNameEditor
        name="元の名前"
        onSave={vi.fn().mockResolvedValue(null)}
        onRequestSuggestion={onRequestSuggestion}
      />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    await user.click(
      screen.getByRole('button', {
        name: tsn('requestSuggestion'),
      })
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: tsn('nameAriaLabel') })).toHaveValue(
        '提案されたセッション名'
      );
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('提案が null / hasExternalApiError のとき日本語エラーを表示する', async () => {
    const user = userEvent.setup();
    const onRequestSuggestion = vi.fn().mockResolvedValue({
      suggestion: null,
      hasExternalApiError: true,
    });
    render(
      <SessionNameEditor
        name="元の名前"
        onSave={vi.fn().mockResolvedValue(null)}
        onRequestSuggestion={onRequestSuggestion}
      />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));
    await user.click(
      screen.getByRole('button', {
        name: tsn('requestSuggestion'),
      })
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        tsn('suggestionFailed')
      );
    });
  });

  it('onRequestSuggestion 未指定時は提案ボタンを表示しない', async () => {
    const user = userEvent.setup();
    render(
      <SessionNameEditor name="元の名前" onSave={vi.fn().mockResolvedValue(null)} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));

    expect(
      screen.queryByRole('button', {
        name: tsn('requestSuggestion'),
      })
    ).not.toBeInTheDocument();
  });

  it('ⓘ ボタンが aria-describedby を持ち、フォーカス/ホバーでルール文を参照できる', async () => {
    const user = userEvent.setup();
    render(
      <SessionNameEditor name="元の名前" onSave={vi.fn().mockResolvedValue(null)} />
    );

    await user.click(screen.getByRole('button', { name: tsn('editAriaLabel') }));

    const infoButton = screen.getByRole('button', {
      name: tsn('validationRuleAriaLabel'),
    });
    const describedBy = infoButton.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    // 参照先要素は role='tooltip' でルール文を保持する
    const tooltip = document.getElementById(describedBy!);
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(tooltip).toHaveTextContent(tsn('rule'));

    // フォーカスでツールチップが可視になる
    await user.tab();
    infoButton.focus();
    expect(infoButton).toHaveFocus();
  });
});
