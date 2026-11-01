import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import fc from 'fast-check';
import { SpeakerLabelManager } from './SpeakerLabelManager';
import type { Segment } from '../types/segment';

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 5,
    originalText: 'テストテキスト',
    speakerLabel: 'spk_0',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('SpeakerLabelManager', () => {
  const segments: Segment[] = [
    createSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0', startTime: 0 }),
    createSegment({ segmentId: 'seg-2', speakerLabel: 'spk_0', startTime: 5 }),
    createSegment({ segmentId: 'seg-3', speakerLabel: 'spk_1', startTime: 10 }),
    createSegment({ segmentId: 'seg-4', speakerLabel: 'spk_1', startTime: 15 }),
    createSegment({ segmentId: 'seg-5', speakerLabel: 'spk_2', startTime: 20 }),
  ];

  const defaultProps = {
    segments,
    onRenameConfirm: vi.fn(),
    onCancel: vi.fn(),
    isOpen: true,
    onClose: vi.fn(),
  };

  describe('話者ラベル管理画面表示 (Requirement 2.13)', () => {
    it('displays all unique speaker labels', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      expect(screen.getByText('spk_0')).toBeInTheDocument();
      expect(screen.getByText('spk_1')).toBeInTheDocument();
      expect(screen.getByText('spk_2')).toBeInTheDocument();
    });

    it('shows segment count for each label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      // spk_0 and spk_1 both have 2 segments, spk_2 has 1
      const countElements = screen.getAllByText(/\(\d+件\)/);
      expect(countElements).toHaveLength(3);
      expect(screen.getByText('(1件)')).toBeInTheDocument(); // spk_2 has 1
    });

    it('shows rename button for each label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      const renameButtons = screen.getAllByRole('button', { name: /の名前変更/ });
      expect(renameButtons).toHaveLength(3);
    });

    it('does not render when isOpen is false', () => {
      render(<SpeakerLabelManager {...defaultProps} isOpen={false} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows empty message when no labels exist', () => {
      render(
        <SpeakerLabelManager
          {...defaultProps}
          segments={[createSegment({ speakerLabel: undefined })]}
        />
      );

      expect(screen.getByText('話者ラベルがありません')).toBeInTheDocument();
    });
  });

  describe('ラベル名変更 (Requirement 2.14)', () => {
    it('shows input field when rename button is clicked', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );

      expect(
        screen.getByLabelText('spk_0 の新しいラベル名')
      ).toBeInTheDocument();
    });

    it('calls onRenameConfirm with updated segments on rename', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, '田中');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ segmentId: 'seg-1', speakerLabel: '田中' }),
          expect.objectContaining({ segmentId: 'seg-2', speakerLabel: '田中' }),
          expect.objectContaining({ segmentId: 'seg-3', speakerLabel: 'spk_1' }),
        ]),
        {
          oldLabel: 'spk_0',
          newLabel: '田中',
          affectedSegmentCount: 2,
        }
      );
    });

    it('confirms rename with Enter key', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, '佐藤');
      await user.keyboard('{Enter}');

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          oldLabel: 'spk_0',
          newLabel: '佐藤',
          affectedSegmentCount: 2,
        })
      );
    });

    it('does not call onRenameConfirm when label name is unchanged', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      // Don't change the text, just confirm
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      expect(onRenameConfirm).not.toHaveBeenCalled();
    });
  });

  describe('キャンセル操作 (Requirement 2.16)', () => {
    it('calls onCancel when cancel button is clicked during rename', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onCancel={onCancel} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      await user.click(screen.getByLabelText('ラベル名変更をキャンセル'));

      expect(onCancel).toHaveBeenCalled();
    });

    it('cancels rename with Escape key', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onCancel={onCancel} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      input.focus();
      await user.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalled();
    });

    it('hides input field after cancel', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      expect(
        screen.getByLabelText('spk_0 の新しいラベル名')
      ).toBeInTheDocument();

      await user.click(screen.getByLabelText('ラベル名変更をキャンセル'));

      expect(
        screen.queryByLabelText('spk_0 の新しいラベル名')
      ).not.toBeInTheDocument();
    });
  });

  describe('ラベル名重複時の確認ダイアログ (Requirement 2.17)', () => {
    it('shows merge confirmation dialog when new name conflicts with existing label', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText(/「spk_1」は既に存在します/)).toBeInTheDocument();
    });

    it('executes merge when user confirms in dialog', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      // Confirm merge
      await user.click(screen.getByLabelText('統合する（話者ラベルを統合して確定）'));

      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ segmentId: 'seg-1', speakerLabel: 'spk_1' }),
          expect.objectContaining({ segmentId: 'seg-2', speakerLabel: 'spk_1' }),
        ]),
        {
          oldLabel: 'spk_0',
          newLabel: 'spk_1',
          affectedSegmentCount: 2,
        }
      );
    });

    it('keeps editing state when user cancels merge dialog', async () => {
      const user = userEvent.setup();
      const onRenameConfirm = vi.fn();
      render(
        <SpeakerLabelManager {...defaultProps} onRenameConfirm={onRenameConfirm} />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      await user.clear(input);
      await user.type(input, 'spk_1');
      await user.click(screen.getByLabelText('ラベル名変更を確定'));

      // Cancel merge
      await user.click(screen.getByLabelText('統合をキャンセル'));

      expect(onRenameConfirm).not.toHaveBeenCalled();
      // Should still be in editing state
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('話者識別情報がない場合 (Requirement 2.9)', () => {
    it('shows empty message when segments have no speaker labels', () => {
      const noSpeakerSegments = [
        createSegment({ segmentId: 'seg-1', speakerLabel: undefined }),
        createSegment({ segmentId: 'seg-2', speakerLabel: undefined }),
      ];
      render(
        <SpeakerLabelManager {...defaultProps} segments={noSpeakerSegments} />
      );

      expect(screen.getByText('話者ラベルがありません')).toBeInTheDocument();
    });
  });

  describe('パネル操作', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SpeakerLabelManager {...defaultProps} onClose={onClose} />);

      await user.click(
        screen.getByLabelText('話者ラベル管理を閉じる')
      );

      expect(onClose).toHaveBeenCalled();
    });

    it('has proper dialog role and label', () => {
      render(<SpeakerLabelManager {...defaultProps} />);

      const dialog = screen.getByRole('dialog', { name: '話者ラベル管理' });
      expect(dialog).toBeInTheDocument();
    });
  });

  describe('話者ラベルの追加', () => {
    it('shows the add input when onAddLabel is provided', () => {
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={vi.fn()} />);
      expect(screen.getByLabelText('追加する話者ラベル名')).toBeInTheDocument();
    });

    it('does not show the add input when onAddLabel is not provided', () => {
      render(<SpeakerLabelManager {...defaultProps} />);
      expect(
        screen.queryByLabelText('追加する話者ラベル名')
      ).not.toBeInTheDocument();
    });

    it('calls onAddLabel with the trimmed label and clears input on success', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, '  新しい話者  ');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).toHaveBeenCalledWith('新しい話者');
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('shows a Japanese error when the label is empty', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).not.toHaveBeenCalled();
      expect(
        screen.getByText('話者ラベルを入力してください。')
      ).toBeInTheDocument();
    });

    it('shows a Japanese error when the label duplicates an existing one', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, 'spk_0');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(onAddLabel).not.toHaveBeenCalled();
      expect(
        screen.getByText('同じ名前の話者ラベルが既に存在します。')
      ).toBeInTheDocument();
    });

    it('surfaces the server error message returned by onAddLabel', async () => {
      const user = userEvent.setup();
      const onAddLabel = vi
        .fn()
        .mockResolvedValue('話者ラベルは既に存在します。');
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      await user.type(input, '新規');
      await user.click(screen.getByLabelText('話者ラベルを追加'));

      expect(
        screen.getByText('話者ラベルは既に存在します。')
      ).toBeInTheDocument();
    });

    it('shows a master label that has no segments via masterLabels', () => {
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onAddLabel={vi.fn()}
          onDeleteLabel={vi.fn()}
        />
      );
      expect(screen.getByText('未使用話者')).toBeInTheDocument();
      // Unused master label (0 segments) is deletable.
      expect(
        screen.getByLabelText('未使用話者 を削除')
      ).toBeInTheDocument();
    });
  });

  describe('話者ラベルの削除', () => {
    it('disables the delete button for a label still in use', () => {
      render(
        <SpeakerLabelManager {...defaultProps} onDeleteLabel={vi.fn()} />
      );
      // spk_0 is used by 2 segments → delete disabled.
      const disabledDelete = screen.getByLabelText(
        'spk_0 を削除（使用中のため不可）'
      );
      expect(disabledDelete).toBeDisabled();
    });

    it('calls onDeleteLabel for an unused label', async () => {
      const user = userEvent.setup();
      const onDeleteLabel = vi.fn().mockResolvedValue(null);
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onDeleteLabel={onDeleteLabel}
        />
      );

      await user.click(screen.getByLabelText('未使用話者 を削除'));

      expect(onDeleteLabel).toHaveBeenCalledWith('未使用話者');
    });

    it('shows the server error message when deletion fails', async () => {
      const user = userEvent.setup();
      const onDeleteLabel = vi
        .fn()
        .mockResolvedValue('この話者ラベルは使用中のため削除できません。');
      render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onDeleteLabel={onDeleteLabel}
        />
      );

      await user.click(screen.getByLabelText('未使用話者 を削除'));

      expect(
        screen.getByText('この話者ラベルは使用中のため削除できません。')
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Bugfix: speaker-label-ime-confirm-fix
  // Property 1: Bug Condition - IME 変換中の Enter で確定処理が発火してしまう
  //
  // Scoped PBT: 決定的バグのため、fc で生成した任意のラベル文字列に対し
  // 「compositionStart 後・isComposing: true の Enter」という具体的な失敗ケースに
  // プロパティをスコープする。IME 変換は fireEvent.compositionStart と
  // isComposing: true / keyCode: 229 を指定した fireEvent.keyDown で再現する
  // （userEvent.keyboard は isComposing を直接制御できないため fireEvent を使用）。
  //
  // CRITICAL: このテストは未修正コード（isComposing 未確認）で FAIL する。
  // 失敗がバグの存在を証明する（確定コールバックが呼ばれてしまう）。
  // ---------------------------------------------------------------------------
  describe('Feature: speaker-label-ime-confirm-fix, Property 1: IME 変換中の Enter で確定処理を発火しない', () => {
    // fc で生成する「新しいラベル名」の生成器。既存ラベル（spk_0/spk_1/spk_2）と
    // 衝突してマージダイアログに分岐しないよう、衝突しない接頭辞で名前空間を分ける。
    const newLabelArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .map((s) => `変換中${s}`)
      .filter((s) => !['spk_0', 'spk_1', 'spk_2'].includes(s));

    /**
     * **Validates: Requirements 1.1, 2.1**
     *
     * リネーム入力で composition 進行中（compositionStart 後・isComposing: true の
     * Enter）では handleConfirmRename（onRenameConfirm）が発火しないことを期待する。
     * 未修正コードでは isComposing を見ずに確定するため FAIL する（呼ばれてしまう）。
     */
    it('リネーム入力: composition 中の Enter で onRenameConfirm が呼ばれない', async () => {
      await fc.assert(
        fc.asyncProperty(newLabelArb, async (labelName) => {
          const onRenameConfirm = vi.fn();
          const user = userEvent.setup();
          const { unmount } = render(
            <SpeakerLabelManager
              {...defaultProps}
              onRenameConfirm={onRenameConfirm}
            />
          );
          try {
            await user.click(
              screen.getByRole('button', { name: 'spk_0 の名前変更' })
            );
            const input = screen.getByLabelText('spk_0 の新しいラベル名');
            // 日本語入力途中の文字列をセット（compositionStart → 変換 Enter）。
            fireEvent.compositionStart(input);
            fireEvent.change(input, { target: { value: labelName } });
            // IME 変換確定のための Enter（変換進行中）。
            fireEvent.keyDown(input, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              isComposing: true,
            });

            // 期待: 変換の確定のみで、リネーム確定（onRenameConfirm）は発火しない。
            expect(onRenameConfirm).not.toHaveBeenCalled();
          } finally {
            unmount();
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 1.3, 2.3**
     *
     * ラベル追加入力で composition 進行中の Enter では handleAddLabel（onAddLabel）が
     * 発火しないことを期待する。未修正コードでは FAIL する（呼ばれてしまう）。
     */
    it('ラベル追加入力: composition 中の Enter で onAddLabel が呼ばれない', async () => {
      await fc.assert(
        fc.asyncProperty(newLabelArb, async (labelName) => {
          const onAddLabel = vi.fn().mockResolvedValue(null);
          const { unmount } = render(
            <SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />
          );
          try {
            const input = screen.getByLabelText('追加する話者ラベル名');
            fireEvent.compositionStart(input);
            fireEvent.change(input, { target: { value: labelName } });
            fireEvent.keyDown(input, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              isComposing: true,
            });

            // 期待: 変換の確定のみで、ラベル追加（onAddLabel）は発火しない。
            expect(onAddLabel).not.toHaveBeenCalled();
          } finally {
            unmount();
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 1.2**
     *
     * 一部ブラウザは IME 変換確定の keydown 時点で isComposing が false に戻り、
     * 代わりに keyCode === 229 を報告する。この Enter でも確定が発火しないことを
     * 期待する。未修正コードでは keyCode を見ないため FAIL する（呼ばれてしまう）。
     */
    it('リネーム入力: keyCode === 229 の Enter で onRenameConfirm が呼ばれない', async () => {
      const onRenameConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <SpeakerLabelManager
          {...defaultProps}
          onRenameConfirm={onRenameConfirm}
        />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      fireEvent.change(input, { target: { value: '山田' } });
      // IME 既知の keyCode 229 を伴う Enter。
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
      });

      expect(onRenameConfirm).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Bugfix: speaker-label-ime-confirm-fix
  // Property 2: Preservation - 非 IME 入力・その他キーの挙動維持
  //
  // Observation-first: 未修正コードで非バグ入力（isComposing: false のキー、
  // ボタンクリック、重複名での確定）の挙動を観測し、その挙動をそのまま保証する。
  // これらは IME ガードの導入（Task 3）後も不変でなければならない。
  //
  // 観測された挙動（未修正コード）:
  //   - 非 IME（isComposing: false）の Enter で onRenameConfirm / onAddLabel が発火する
  //   - リネーム入力の Escape で onCancel（handleCancelRename）が発火する
  //   - Enter / Escape 以外のキー（文字キー等, isComposing: false）では確定/キャンセルは発火しない
  //   - 「確定」「追加」ボタンのクリックで確定が発火する（キーダウン非経由）
  //   - 既存ラベルと重複する名前で（非 IME）確定するとマージ確認ダイアログが表示される
  //
  // CRITICAL: このテストは未修正コードで PASS する（保持すべきベースライン）。
  // IME 検証箇所と同様に、isComposing を明示制御するため fireEvent を用いる
  // （userEvent.keyboard は isComposing を直接制御できないため）。
  // ---------------------------------------------------------------------------
  describe('Feature: speaker-label-ime-confirm-fix, Property 2: 非 IME 入力・その他キーの挙動維持', () => {
    // 既存ラベル（spk_0/spk_1/spk_2）と衝突してマージ分岐に入らない名前空間。
    // 観測挙動: コンポーネントは確定前に値を trim する。前後空白で確定値がぶれて
    // 観測が不安定にならないよう、前後に空白を含まない文字列に制約する
    // （trim の保持挙動自体はボタンクリックの既存ユニットテストで担保済み）。
    const nonConflictingLabelArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .map((s) => `新規${s}`)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => !['spk_0', 'spk_1', 'spk_2'].includes(s));

    // 非 IME のキー種別（いずれも isComposing: false）。Enter は確定、Escape は
    // キャンセル、その他キーは確定もキャンセルもしない、という観測を保証する。
    type NonImeKey =
      | { key: 'Enter'; code: 'Enter'; keyCode: 13 }
      | { key: 'Escape'; code: 'Escape'; keyCode: 27 }
      | { key: 'a'; code: 'KeyA'; keyCode: 65 }
      | { key: 'ArrowLeft'; code: 'ArrowLeft'; keyCode: 37 };

    const nonImeKeyArb = fc.constantFrom<NonImeKey>(
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Escape', code: 'Escape', keyCode: 27 },
      { key: 'a', code: 'KeyA', keyCode: 65 },
      { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }
    );

    /**
     * **Validates: Requirements 3.1, 3.2**
     *
     * リネーム入力での非 IME（isComposing: false）キー押下の挙動を保持する。
     * 観測どおり: 非 IME Enter → onRenameConfirm 発火、Escape → onCancel 発火、
     * その他キー → どちらも発火しない。IME ガード導入後も不変であることを保証する。
     * 未修正コードでは isComposing を見ないため、非 IME キーは従来挙動どおり PASS する。
     */
    it('リネーム入力: 非 IME の Enter で確定・Escape でキャンセル・その他キーは不発火', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonConflictingLabelArb,
          nonImeKeyArb,
          async (labelName, keyEvent) => {
            const onRenameConfirm = vi.fn();
            const onCancel = vi.fn();
            const user = userEvent.setup();
            const { unmount } = render(
              <SpeakerLabelManager
                {...defaultProps}
                onRenameConfirm={onRenameConfirm}
                onCancel={onCancel}
              />
            );
            try {
              await user.click(
                screen.getByRole('button', { name: 'spk_0 の名前変更' })
              );
              const input = screen.getByLabelText('spk_0 の新しいラベル名');
              // 非 IME 入力（composition を経ない）で新しい名前を設定する。
              fireEvent.change(input, { target: { value: labelName } });
              // isComposing: false（非 IME）のキー押下。
              fireEvent.keyDown(input, {
                key: keyEvent.key,
                code: keyEvent.code,
                keyCode: keyEvent.keyCode,
                isComposing: false,
              });

              if (keyEvent.key === 'Enter') {
                // 観測: 非 IME Enter で確定が発火し、キャンセルは発火しない。
                expect(onRenameConfirm).toHaveBeenCalledWith(
                  expect.any(Array),
                  expect.objectContaining({
                    oldLabel: 'spk_0',
                    newLabel: labelName,
                    affectedSegmentCount: 2,
                  })
                );
                expect(onCancel).not.toHaveBeenCalled();
              } else if (keyEvent.key === 'Escape') {
                // 観測: Escape でキャンセルが発火し、確定は発火しない。
                expect(onCancel).toHaveBeenCalled();
                expect(onRenameConfirm).not.toHaveBeenCalled();
              } else {
                // 観測: Enter / Escape 以外のキーでは確定もキャンセルも発火しない。
                expect(onRenameConfirm).not.toHaveBeenCalled();
                expect(onCancel).not.toHaveBeenCalled();
              }
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * ラベル追加入力での非 IME（isComposing: false）キー押下の挙動を保持する。
     * 観測どおり: 非 IME Enter → onAddLabel 発火、その他キー → 発火しない。
     * IME ガード導入後も不変であることを保証する。
     */
    it('ラベル追加入力: 非 IME の Enter で追加発火・その他キーは不発火', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonConflictingLabelArb,
          nonImeKeyArb,
          async (labelName, keyEvent) => {
            const onAddLabel = vi.fn().mockResolvedValue(null);
            const { unmount } = render(
              <SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />
            );
            try {
              const input = screen.getByLabelText('追加する話者ラベル名');
              fireEvent.change(input, { target: { value: labelName } });
              fireEvent.keyDown(input, {
                key: keyEvent.key,
                code: keyEvent.code,
                keyCode: keyEvent.keyCode,
                isComposing: false,
              });

              if (keyEvent.key === 'Enter') {
                // 観測: 非 IME Enter でラベル追加が発火する（trim 済みの値で）。
                expect(onAddLabel).toHaveBeenCalledWith(labelName);
              } else {
                // 観測: Enter 以外のキーではラベル追加は発火しない。
                expect(onAddLabel).not.toHaveBeenCalled();
              }
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 3.4**
     *
     * 「確定」「追加」ボタンのクリック（キーダウン非経由）で確定が発火する挙動を
     * 保持する。IME ガードはキーダウンにのみ作用するため、ボタンクリックは不変。
     */
    it('ボタンクリック（キーダウン非経由）での確定・追加発火を保持する', async () => {
      await fc.assert(
        fc.asyncProperty(nonConflictingLabelArb, async (labelName) => {
          const onRenameConfirm = vi.fn();
          const onAddLabel = vi.fn().mockResolvedValue(null);
          const user = userEvent.setup();
          const { unmount } = render(
            <SpeakerLabelManager
              {...defaultProps}
              onRenameConfirm={onRenameConfirm}
              onAddLabel={onAddLabel}
            />
          );
          try {
            // リネーム「確定」ボタンのクリックで確定が発火する。
            await user.click(
              screen.getByRole('button', { name: 'spk_0 の名前変更' })
            );
            const renameInput = screen.getByLabelText('spk_0 の新しいラベル名');
            fireEvent.change(renameInput, { target: { value: labelName } });
            await user.click(screen.getByLabelText('ラベル名変更を確定'));
            expect(onRenameConfirm).toHaveBeenCalledWith(
              expect.any(Array),
              expect.objectContaining({
                oldLabel: 'spk_0',
                newLabel: labelName,
                affectedSegmentCount: 2,
              })
            );

            // 「追加」ボタンのクリックで追加が発火する。
            const addInput = screen.getByLabelText('追加する話者ラベル名');
            fireEvent.change(addInput, { target: { value: labelName } });
            await user.click(screen.getByLabelText('話者ラベルを追加'));
            expect(onAddLabel).toHaveBeenCalledWith(labelName);
          } finally {
            unmount();
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 3.5**
     *
     * 既存ラベルと重複する名前で（非 IME）確定したとき、マージ確認ダイアログ
     * （Req 2.17 相当）が表示される挙動を保持する。IME ガード導入後も不変。
     */
    it('重複名での（非 IME）確定時にマージ確認ダイアログを表示する', async () => {
      // 既存ラベル（spk_0 以外）から衝突名を生成し、マージ分岐を確実に通す。
      const conflictingLabelArb = fc.constantFrom('spk_1', 'spk_2');

      await fc.assert(
        fc.asyncProperty(conflictingLabelArb, async (conflictLabel) => {
          const onRenameConfirm = vi.fn();
          const user = userEvent.setup();
          const { unmount } = render(
            <SpeakerLabelManager
              {...defaultProps}
              onRenameConfirm={onRenameConfirm}
            />
          );
          try {
            await user.click(
              screen.getByRole('button', { name: 'spk_0 の名前変更' })
            );
            const input = screen.getByLabelText('spk_0 の新しいラベル名');
            fireEvent.change(input, { target: { value: conflictLabel } });
            // 非 IME の Enter で確定 → 重複のためマージ確認ダイアログが表示される。
            fireEvent.keyDown(input, {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              isComposing: false,
            });

            // 観測: マージ確認ダイアログが表示され、確定はまだ発火しない。
            expect(screen.getByRole('alertdialog')).toBeInTheDocument();
            expect(onRenameConfirm).not.toHaveBeenCalled();
          } finally {
            unmount();
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Bugfix: speaker-label-ime-confirm-fix — Task 4
  // Unit Tests: 決定的なユニットテスト。
  //
  // Property 1/2（プロパティテスト）がカバーしていない「composition 終了後
  // （compositionEnd 後）の Enter で確定が発火する」正しい確定挙動（Req 2.2）を
  // 決定的に検証する。IME 変換確定後の Enter は次の流れで再現する:
  //   fireEvent.compositionStart → fireEvent.change → fireEvent.compositionEnd
  //   → その後 isComposing: false / keyCode: 13 の fireEvent.keyDown で Enter。
  // compositionEnd で isComposingRef が false に戻るため確定が発火する。
  // ---------------------------------------------------------------------------
  describe('Bugfix speaker-label-ime-confirm-fix — Unit: IME 変換確定後の Enter で確定する', () => {
    it('リネーム入力: composition 中の Enter では確定せず、compositionEnd 後の Enter で確定する', async () => {
      const onRenameConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <SpeakerLabelManager
          {...defaultProps}
          onRenameConfirm={onRenameConfirm}
        />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');

      // 変換中: compositionStart → 文字入力 → 変換 Enter（確定は発火しない）。
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: '山田' } });
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
      expect(onRenameConfirm).not.toHaveBeenCalled();

      // 変換確定後: compositionEnd → isComposing: false の Enter で確定が発火する。
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
      });

      expect(onRenameConfirm).toHaveBeenCalledTimes(1);
      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          oldLabel: 'spk_0',
          newLabel: '山田',
          affectedSegmentCount: 2,
        })
      );
    });

    it('ラベル追加入力: composition 中の Enter では追加せず、compositionEnd 後の Enter で追加する', async () => {
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');

      // 変換中: compositionStart → 文字入力 → 変換 Enter（追加は発火しない）。
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: '花子' } });
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
      expect(onAddLabel).not.toHaveBeenCalled();

      // 変換確定後: compositionEnd → isComposing: false の Enter で追加が発火する。
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
      });

      expect(onAddLabel).toHaveBeenCalledTimes(1);
      expect(onAddLabel).toHaveBeenCalledWith('花子');
    });

    it('リネーム入力: keyCode === 229 の Enter では確定が発火しない（エッジケース）', async () => {
      const onRenameConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <SpeakerLabelManager
          {...defaultProps}
          onRenameConfirm={onRenameConfirm}
        />
      );

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      fireEvent.change(input, { target: { value: '山田' } });
      // IME 既知の keyCode 229 を伴う Enter（isComposing が false に戻っていても無視）。
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        isComposing: false,
      });

      expect(onRenameConfirm).not.toHaveBeenCalled();
    });

    it('ラベル追加入力: keyCode === 229 の Enter では追加が発火しない（エッジケース）', async () => {
      const onAddLabel = vi.fn().mockResolvedValue(null);
      render(<SpeakerLabelManager {...defaultProps} onAddLabel={onAddLabel} />);

      const input = screen.getByLabelText('追加する話者ラベル名');
      fireEvent.change(input, { target: { value: '花子' } });
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        isComposing: false,
      });

      expect(onAddLabel).not.toHaveBeenCalled();
    });

    it('リネーム入力: Escape でキャンセル（handleCancelRename）が従来どおり発火する', async () => {
      const onCancel = vi.fn();
      const user = userEvent.setup();
      render(<SpeakerLabelManager {...defaultProps} onCancel={onCancel} />);

      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');
      fireEvent.keyDown(input, {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        isComposing: false,
      });

      expect(onCancel).toHaveBeenCalledTimes(1);
      // キャンセル後は入力欄が閉じる。
      expect(
        screen.queryByLabelText('spk_0 の新しいラベル名')
      ).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Bugfix: speaker-label-ime-confirm-fix — Task 4
  // Integration Tests: 日本語入力フロー全体とコンテキスト切替を検証する。
  // ---------------------------------------------------------------------------
  describe('Bugfix speaker-label-ime-confirm-fix — Integration: 日本語入力フロー / コンテキスト切替', () => {
    it('日本語入力フロー: compositionStart → 入力 → 変換 Enter（確定なし）→ compositionEnd → 確定 Enter（リネーム確定）', async () => {
      const onRenameConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <SpeakerLabelManager
          {...defaultProps}
          onRenameConfirm={onRenameConfirm}
        />
      );

      // リネーム編集を開始する。
      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      const input = screen.getByLabelText('spk_0 の新しいラベル名');

      // 1) IME 変換開始。
      fireEvent.compositionStart(input);
      // 2) 「やまだ」を入力（変換前のかな）。
      fireEvent.change(input, { target: { value: 'やまだ' } });
      // 3) 変換候補「山田」を選ぶ（確定前の表示文字列を更新）。
      fireEvent.change(input, { target: { value: '山田' } });
      // 4) 変換確定のための Enter（IME 進行中）— リネームは確定しない。
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
      expect(onRenameConfirm).not.toHaveBeenCalled();

      // 5) 変換確定（compositionEnd）。
      fireEvent.compositionEnd(input);
      // 6) 改めての確定 Enter（非 IME）— ここで初めてリネームが確定する。
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
      });

      expect(onRenameConfirm).toHaveBeenCalledTimes(1);
      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          oldLabel: 'spk_0',
          newLabel: '山田',
          affectedSegmentCount: 2,
        })
      );
    });

    it('コンテキスト切替: ラベル追加入力とリネーム入力で IME ガードと確定が独立して動作する', async () => {
      const onRenameConfirm = vi.fn();
      const onAddLabel = vi.fn().mockResolvedValue(null);
      const user = userEvent.setup();
      render(
        <SpeakerLabelManager
          {...defaultProps}
          onRenameConfirm={onRenameConfirm}
          onAddLabel={onAddLabel}
        />
      );

      // --- コンテキスト A: ラベル追加入力 ---
      const addInput = screen.getByLabelText('追加する話者ラベル名');
      // 変換中 Enter → 追加は発火しない。
      fireEvent.compositionStart(addInput);
      fireEvent.change(addInput, { target: { value: '花子' } });
      fireEvent.keyDown(addInput, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
      expect(onAddLabel).not.toHaveBeenCalled();
      // 変換確定後 Enter → 追加が発火する。
      fireEvent.compositionEnd(addInput);
      fireEvent.keyDown(addInput, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
      });
      expect(onAddLabel).toHaveBeenCalledTimes(1);
      expect(onAddLabel).toHaveBeenCalledWith('花子');

      // --- コンテキスト B: リネーム入力（別入力へ切替） ---
      await user.click(
        screen.getByRole('button', { name: 'spk_1 の名前変更' })
      );
      const renameInput = screen.getByLabelText('spk_1 の新しいラベル名');
      // 変換中 Enter → リネームは発火しない（追加側のガードとは独立）。
      fireEvent.compositionStart(renameInput);
      fireEvent.change(renameInput, { target: { value: '太郎' } });
      fireEvent.keyDown(renameInput, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
      expect(onRenameConfirm).not.toHaveBeenCalled();
      // 変換確定後 Enter → リネームが確定する。
      fireEvent.compositionEnd(renameInput);
      fireEvent.keyDown(renameInput, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
      });
      expect(onRenameConfirm).toHaveBeenCalledTimes(1);
      expect(onRenameConfirm).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          oldLabel: 'spk_1',
          newLabel: '太郎',
          affectedSegmentCount: 2,
        })
      );
      // 追加側は 1 回のまま（コンテキストが独立していることの確認）。
      expect(onAddLabel).toHaveBeenCalledTimes(1);
    });

    it('コンテキスト切替後のパネル描画でアクセシビリティ違反がない', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onAddLabel={vi.fn()}
          onDeleteLabel={vi.fn()}
        />
      );

      // リネーム編集を開いた状態（入力欄が描画された状態）でも違反ゼロを維持する。
      await user.click(
        screen.getByRole('button', { name: 'spk_0 の名前変更' })
      );
      expect(
        screen.getByLabelText('spk_0 の新しいラベル名')
      ).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('アクセシビリティ (WCAG 2.1 AA)', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(
        <SpeakerLabelManager
          {...defaultProps}
          masterLabels={['未使用話者']}
          onAddLabel={vi.fn()}
          onDeleteLabel={vi.fn()}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
