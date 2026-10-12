import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageModelPage } from './LanguageModelPage';
import type { LanguageModelApi } from '../services/language-model-api';
import type { UseLanguageModelsReturn } from '../hooks/useLanguageModels';
import type { ReviewSession } from '../types/session';

function createMockLanguageModelApi(): LanguageModelApi {
  return {
    listModels: vi.fn(),
    createModel: vi.fn(),
    getModelStatus: vi.fn(),
  } as unknown as LanguageModelApi;
}

function createMockHook(overrides?: Partial<UseLanguageModelsReturn>): UseLanguageModelsReturn {
  return {
    models: [],
    isLoadingModels: false,
    loadModels: vi.fn(),
    modelsError: null,
    createModel: vi.fn().mockResolvedValue(null),
    isCreating: false,
    createError: null,
    modelStatus: null,
    isPollingStatus: false,
    statusError: null,
    startStatusPolling: vi.fn(),
    stopStatusPolling: vi.fn(),
    ...overrides,
  };
}

const mockSessions: ReviewSession[] = [
  {
    sessionId: 'session-1',
    transcriptionJobId: 'job-1',
    name: '会議セッション A',
    status: 'COMPLETED',
    assignedReviewerCount: 3,
    consensusThreshold: 2,
    createdAt: '2024-06-01T10:00:00.000Z',
    updatedAt: '2024-06-01T12:00:00.000Z',
  },
  {
    sessionId: 'session-2',
    transcriptionJobId: 'job-2',
    name: 'インタビューセッション B',
    status: 'IN_PROGRESS',
    assignedReviewerCount: 2,
    consensusThreshold: 2,
    createdAt: '2024-06-02T14:00:00.000Z',
    updatedAt: '2024-06-02T15:00:00.000Z',
  },
];

describe('LanguageModelPage', () => {
  let mockApi: LanguageModelApi;
  let mockHook: UseLanguageModelsReturn;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockApi = createMockLanguageModelApi();
    mockHook = createMockHook();
    user = userEvent.setup();
  });

  describe('access control', () => {
    it('shows access denied message for Reviewer role', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="REVIEWER"
        />,
      );

      expect(screen.getByText('アクセス権限がありません')).toBeInTheDocument();
      expect(
        screen.getByText('この機能は Admin または TeamLeader のみ利用できます。'),
      ).toBeInTheDocument();
    });

    it('renders the page for Admin role', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('カスタム言語モデル管理')).toBeInTheDocument();
      expect(screen.getByText('新規モデル作成')).toBeInTheDocument();
    });

    it('renders the page for TeamLeader role', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="TEAM_LEADER"
        />,
      );

      expect(screen.getByText('カスタム言語モデル管理')).toBeInTheDocument();
      expect(screen.getByText('新規モデル作成')).toBeInTheDocument();
    });
  });

  describe('model list', () => {
    it('shows loading state when models are loading', () => {
      const hook = createMockHook({ isLoadingModels: true });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    });

    it('shows empty message when no models exist', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('カスタム言語モデルがありません')).toBeInTheDocument();
    });

    it('displays model list with status badges', () => {
      const hook = createMockHook({
        models: [
          { modelName: 'model-alpha', modelStatus: 'COMPLETED', baseModelName: 'NarrowBand' },
          { modelName: 'model-beta', modelStatus: 'IN_PROGRESS', baseModelName: 'WideBand' },
          { modelName: 'model-gamma', modelStatus: 'FAILED' },
        ],
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('model-alpha')).toBeInTheDocument();
      expect(screen.getByText('model-beta')).toBeInTheDocument();
      expect(screen.getByText('model-gamma')).toBeInTheDocument();

      // Use getAllByText since "完了" appears in both model status badges and session status
      const modelList = screen.getByRole('list', { name: 'カスタム言語モデル一覧' });
      expect(modelList).toBeInTheDocument();
      expect(modelList.textContent).toContain('完了');
      expect(modelList.textContent).toContain('作成中');
      expect(modelList.textContent).toContain('失敗');
    });

    it('shows error message when model loading fails', () => {
      const hook = createMockHook({
        modelsError: { code: 'NETWORK_ERROR', message: 'モデル一覧の取得に失敗しました' },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('モデル一覧の取得に失敗しました')).toBeInTheDocument();
    });
  });

  describe('model creation form', () => {
    it('renders model name input, base model selection, and session list', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByLabelText('モデル名')).toBeInTheDocument();
      expect(screen.getByText('ベースモデル')).toBeInTheDocument();
      expect(screen.getByText('NarrowBand')).toBeInTheDocument();
      expect(screen.getByText('WideBand')).toBeInTheDocument();
      expect(screen.getByText('対象校閲セッション')).toBeInTheDocument();
      expect(screen.getByText('会議セッション A')).toBeInTheDocument();
      expect(screen.getByText('インタビューセッション B')).toBeInTheDocument();
    });

    it('shows validation error when model name is empty', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(screen.getByText('モデル名を入力してください。')).toBeInTheDocument();
    });

    it('shows validation error for invalid model name characters', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText('モデル名'), 'invalid model name!');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(
        screen.getByText('モデル名は英数字、ハイフン、アンダースコアのみ使用できます。'),
      ).toBeInTheDocument();
    });

    it('shows validation error for duplicate model name', async () => {
      const hook = createMockHook({
        models: [{ modelName: 'existing-model', modelStatus: 'COMPLETED' }],
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText('モデル名'), 'existing-model');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(
        screen.getByText('同じ名前のモデルが既に存在します。別の名前を指定してください。'),
      ).toBeInTheDocument();
    });

    it('shows validation error when no sessions are selected', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText('モデル名'), 'valid-model');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(
        screen.getByText('対象の校閲セッションを1つ以上選択してください。'),
      ).toBeInTheDocument();
    });

    it('calls createModel with correct parameters on valid submission', async () => {
      const createModel = vi.fn().mockResolvedValue({
        modelName: 'new-model',
        baseModelName: 'NarrowBand',
        status: 'IN_PROGRESS',
        trainingDataS3Uri: 's3://bucket/training-data/new-model/training.txt',
        createdBy: 'user-1',
        createdAt: '2024-06-15T10:00:00.000Z',
      });
      const hook = createMockHook({ createModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText('モデル名'), 'new-model');

      // Select a session
      const sessionCheckbox = screen.getByRole('checkbox', { name: /会議セッション A/ });
      await user.click(sessionCheckbox);

      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      await waitFor(() => {
        expect(createModel).toHaveBeenCalledWith({
          modelName: 'new-model',
          baseModelName: 'NarrowBand',
          sessionIds: ['session-1'],
        });
      });
    });

    it('shows success message after model creation', async () => {
      const createModel = vi.fn().mockResolvedValue({
        modelName: 'new-model',
        baseModelName: 'NarrowBand',
        status: 'IN_PROGRESS',
        trainingDataS3Uri: 's3://bucket/training-data/new-model/training.txt',
        createdBy: 'user-1',
        createdAt: '2024-06-15T10:00:00.000Z',
      });
      const hook = createMockHook({ createModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText('モデル名'), 'new-model');
      await user.click(screen.getByRole('checkbox', { name: /会議セッション A/ }));
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      await waitFor(() => {
        expect(screen.getByText(/モデル「new-model」の作成を開始しました/)).toBeInTheDocument();
      });
    });

    it('shows API error when model creation fails', () => {
      const hook = createMockHook({
        createError: { code: 'CREATE_FAILED', message: 'モデルの作成に失敗しました' },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('モデルの作成に失敗しました')).toBeInTheDocument();
    });

    it('shows session loading state', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={[]}
          userRole="ADMIN"
          isLoadingSessions={true}
        />,
      );

      expect(screen.getByText('セッション読み込み中...')).toBeInTheDocument();
    });

    it('shows empty sessions message when no sessions available', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={[]}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('利用可能な校閲セッションがありません。')).toBeInTheDocument();
    });
  });

  describe('model status polling', () => {
    it('shows status banner when polling is active', () => {
      const hook = createMockHook({
        isPollingStatus: true,
        modelStatus: { modelName: 'my-model', modelStatus: 'IN_PROGRESS' },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText(/モデル「my-model」: 作成中/)).toBeInTheDocument();
    });

    it('shows completed status in banner', () => {
      const hook = createMockHook({
        isPollingStatus: true,
        modelStatus: { modelName: 'my-model', modelStatus: 'COMPLETED' },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText(/モデル「my-model」: 完了/)).toBeInTheDocument();
    });

    it('shows failure reason in banner when model creation fails', () => {
      const hook = createMockHook({
        isPollingStatus: true,
        modelStatus: {
          modelName: 'my-model',
          modelStatus: 'FAILED',
          failureReason: 'トレーニングデータが不足しています',
        },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByText('トレーニングデータが不足しています')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA landmark for main content', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByRole('main', { name: 'カスタム言語モデル管理' })).toBeInTheDocument();
    });

    it('has proper ARIA landmark for access denied page', () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="REVIEWER"
        />,
      );

      expect(screen.getByRole('main', { name: 'カスタム言語モデル管理' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
