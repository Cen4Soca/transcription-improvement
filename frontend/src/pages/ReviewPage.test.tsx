import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ReviewPage } from './ReviewPage';
import type { DeletionApi } from '../services/deletion-api';
import type { Segment } from '../types/segment';

// ReviewPage は useAuth を参照するためモックする。
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'admin-1', role: 'ADMIN', displayName: 'Admin', email: 'admin@test.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

function renderReviewPage(overrides: Partial<React.ComponentProps<typeof ReviewPage>> = {}) {
  return render(
    <MemoryRouter>
      <ReviewPage
        segments={[]}
        mediaUrl={null}
        sessionId="session-1"
        sessionName="テストセッション"
        userRole="ADMIN"
        {...overrides}
      />
    </MemoryRouter>,
  );
}

const createCorrectedSegment = (overrides?: Partial<Segment>): Segment => ({
  segmentId: 'seg-1',
  sessionId: 'session-1',
  startTime: 10,
  endTime: 15,
  // 「originalText=最新テキスト」不変条件: 修正済みは修正後テキストが最新
  originalText: '修正後テキスト',
  consensusStatus: 'UNDECIDED',
  ...overrides,
});

describe('ReviewPage - 修正前に戻す / 修正候補 (要件A/B)', () => {
  const correctedSegment = createCorrectedSegment();
  const displayCorrections = new Map([
    ['seg-1', { originalText: '修正前テキスト', correctedText: '修正後テキスト' }],
  ]);

  it('要件A: 修正済みセグメントの「修正前に戻す」クリックで onRevertCorrection が呼ばれる', async () => {
    const onRevertCorrection = vi.fn().mockResolvedValue(true);

    renderReviewPage({
      segments: [correctedSegment],
      displayCorrections,
      correctedSegmentIds: new Set(['seg-1']),
      onSaveCorrection: vi.fn().mockResolvedValue(true),
      onFetchSuggestions: vi
        .fn()
        .mockResolvedValue({ suggestions: [], hasError: false }),
      onRevertCorrection,
    });

    fireEvent.click(screen.getByRole('button', { name: '修正前に戻す' }));

    await waitFor(() => {
      expect(onRevertCorrection).toHaveBeenCalledWith('seg-1');
    });
  });

  it('要件B: 修正済みセグメントでも「修正候補を表示」ボタンが表示され押下できる', () => {
    renderReviewPage({
      segments: [correctedSegment],
      displayCorrections,
      correctedSegmentIds: new Set(['seg-1']),
      onSaveCorrection: vi.fn().mockResolvedValue(true),
      onFetchSuggestions: vi
        .fn()
        .mockResolvedValue({ suggestions: [], hasError: false }),
      onRevertCorrection: vi.fn().mockResolvedValue(true),
    });

    const suggestionButton = screen.getByRole('button', { name: '修正候補を表示' });
    expect(suggestionButton).toBeInTheDocument();
    fireEvent.click(suggestionButton);
  });

  it('onRevertCorrection 未指定時は「修正前に戻す」ボタンを表示しない', () => {
    renderReviewPage({
      segments: [correctedSegment],
      displayCorrections,
      correctedSegmentIds: new Set(['seg-1']),
      onSaveCorrection: vi.fn().mockResolvedValue(true),
    });

    expect(
      screen.queryByRole('button', { name: '修正前に戻す' })
    ).not.toBeInTheDocument();
  });

  it('修正済みセグメント表示にアクセシビリティ違反がない (WCAG 2.1 AA)', async () => {
    const { container } = renderReviewPage({
      segments: [correctedSegment],
      displayCorrections,
      correctedSegmentIds: new Set(['seg-1']),
      onSaveCorrection: vi.fn().mockResolvedValue(true),
      onFetchSuggestions: vi
        .fn()
        .mockResolvedValue({ suggestions: [], hasError: false }),
      onRevertCorrection: vi.fn().mockResolvedValue(true),
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ReviewPage - 完了セッションの読み取り専用化 (Req 2.18, 2.19)', () => {
  // 話者ラベル管理ボタンの表示条件（Segment に speakerLabel がある）を満たすため label を付与。
  const correctedSegment = createCorrectedSegment({ speakerLabel: 'spk_0' });
  const displayCorrections = new Map([
    ['seg-1', { originalText: '修正前テキスト', correctedText: '修正後テキスト' }],
  ]);

  const transcriptionApi = {
    requestDownload: vi.fn(),
  } as unknown as React.ComponentProps<typeof ReviewPage>['transcriptionApi'];

  function renderCompleted(
    overrides: Partial<React.ComponentProps<typeof ReviewPage>> = {},
  ) {
    return renderReviewPage({
      segments: [correctedSegment],
      displayCorrections,
      correctedSegmentIds: new Set(['seg-1']),
      onSaveCorrection: vi.fn().mockResolvedValue(true),
      onFetchSuggestions: vi
        .fn()
        .mockResolvedValue({ suggestions: [], hasError: false }),
      onRevertCorrection: vi.fn().mockResolvedValue(true),
      onAddSpeakerLabel: vi.fn().mockResolvedValue(null),
      onDeleteSpeakerLabel: vi.fn().mockResolvedValue(null),
      transcriptionApi,
      sessionStatus: 'COMPLETED',
      ...overrides,
    });
  }

  it('COMPLETED では編集・話者ラベル管理・候補・修正前に戻す UI を表示しない', () => {
    renderCompleted();

    expect(
      screen.queryByRole('button', { name: '話者ラベル管理を開く' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '修正候補を表示' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '修正前に戻す' }),
    ).not.toBeInTheDocument();
  });

  it('COMPLETED では読み取り専用の role="status" 通知を表示する', () => {
    renderCompleted();

    expect(
      screen.getByText('完了したセッションのため編集できません。'),
    ).toBeInTheDocument();
  });

  it('COMPLETED でも TranscriptionDownload は表示される', () => {
    renderCompleted();

    expect(
      screen.getByRole('button', { name: 'ダウンロード' }),
    ).toBeInTheDocument();
  });

  it('IN_PROGRESS では編集 UI が従来どおり表示される (regression)', () => {
    renderCompleted({ sessionStatus: 'IN_PROGRESS' });

    expect(
      screen.getByRole('button', { name: '話者ラベル管理を開く' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '修正候補を表示' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '修正前に戻す' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('完了したセッションのため編集できません。'),
    ).not.toBeInTheDocument();
  });

  it('完了セッションの読み取り専用表示にアクセシビリティ違反がない (WCAG 2.1 AA)', async () => {
    // TranscriptionDownload は既存の見出し階層（h1→h3）を持ち本機能の対象外のため、
    // 読み取り専用化そのものの a11y を検証する際は描画しない。
    const { container } = renderCompleted({ transcriptionApi: undefined });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ReviewPage - Transcription 削除', () => {
  it('削除を確定すると onTranscriptionDeleted が呼ばれる', async () => {
    const onTranscriptionDeleted = vi.fn();
    const deletionApi = {
      deleteTranscription: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { message: 'deleted' } }),
      deleteMediaFile: vi.fn(),
    } as unknown as DeletionApi;

    renderReviewPage({ deletionApi, onTranscriptionDeleted });

    // ツールバーの削除ボタンでダイアログを開く
    fireEvent.click(screen.getByRole('button', { name: 'Transcription を削除' }));

    // ダイアログ内の「削除する」で確定
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(deletionApi.deleteTranscription).toHaveBeenCalledWith('session-1');
      expect(onTranscriptionDeleted).toHaveBeenCalledTimes(1);
    });
  });

  it('削除が失敗した場合は onTranscriptionDeleted を呼ばない', async () => {
    const onTranscriptionDeleted = vi.fn();
    const deletionApi = {
      deleteTranscription: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: 'INTERNAL_ERROR', message: '削除に失敗' } }),
      deleteMediaFile: vi.fn(),
    } as unknown as DeletionApi;

    renderReviewPage({ deletionApi, onTranscriptionDeleted });

    fireEvent.click(screen.getByRole('button', { name: 'Transcription を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(deletionApi.deleteTranscription).toHaveBeenCalledWith('session-1');
    });
    expect(onTranscriptionDeleted).not.toHaveBeenCalled();
  });
});

describe('ReviewPage - セッション名編集', () => {
  it('onRenameSession 未指定時はセッション名を静的表示する', () => {
    renderReviewPage({ sessionName: '静的セッション名' });

    expect(screen.getByText('静的セッション名')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'セッション名を編集' })
    ).not.toBeInTheDocument();
  });

  it('onRenameSession 指定時は編集 UI を表示し trim 済みの名前で保存する', async () => {
    const onRenameSession = vi.fn().mockResolvedValue(null);

    renderReviewPage({
      sessionName: '旧セッション名',
      onRenameSession,
    });

    fireEvent.click(screen.getByRole('button', { name: 'セッション名を編集' }));
    const input = screen.getByRole('textbox', { name: 'セッション名' });
    fireEvent.change(input, { target: { value: '  新セッション名  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onRenameSession).toHaveBeenCalledWith('新セッション名');
    });
  });

  it('名前提案ボタンで候補を入力欄にセットする', async () => {
    const onRequestNameSuggestion = vi.fn().mockResolvedValue({
      suggestion: '提案名',
      hasExternalApiError: false,
    });

    renderReviewPage({
      sessionName: '旧セッション名',
      onRenameSession: vi.fn().mockResolvedValue(null),
      onRequestNameSuggestion,
    });

    fireEvent.click(screen.getByRole('button', { name: 'セッション名を編集' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'トランスクリプションから名前を提案',
      })
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'セッション名' })).toHaveValue(
        '提案名'
      );
    });
  });

  it('セッション名編集 UI にアクセシビリティ違反がない (WCAG 2.1 AA)', async () => {
    const { container } = renderReviewPage({
      sessionName: 'アクセシブルなセッション名',
      onRenameSession: vi.fn().mockResolvedValue(null),
      onRequestNameSuggestion: vi
        .fn()
        .mockResolvedValue({ suggestion: '提案名', hasExternalApiError: false }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'セッション名を編集' }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
