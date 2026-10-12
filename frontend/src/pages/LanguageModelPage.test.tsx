import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { LanguageModelPage } from './LanguageModelPage';
import type { LanguageModelApi } from '../services/language-model-api';
import type { UseLanguageModelsReturn } from '../hooks/useLanguageModels';
import type { ReviewSession } from '../types/session';
import type { Team } from '../types/team';

const mockTeams: Team[] = [
  { teamId: 'team-1', name: 'チームA', createdBy: 'admin-1', createdAt: '2024-01-01T00:00:00.000Z' },
  { teamId: 'team-2', name: 'チームB', createdBy: 'admin-1', createdAt: '2024-01-02T00:00:00.000Z' },
];

function createMockLanguageModelApi(): LanguageModelApi {
  return {
    listModels: vi.fn(),
    createModel: vi.fn(),
    getModelStatus: vi.fn(),
    deleteModel: vi.fn(),
    updateModelName: vi.fn(),
    updateModelTeam: vi.fn(),
    getMyTeams: vi.fn().mockResolvedValue({ ok: true, value: { data: mockTeams } }),
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
    deleteModel: vi.fn().mockResolvedValue(true),
    renameModel: vi.fn().mockResolvedValue(null),
    changeModelTeam: vi.fn().mockResolvedValue(null),
    reDelete: vi.fn().mockResolvedValue(true),
    isMutating: false,
    mutationError: null,
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

    it('loads the caller teams via getMyTeams for the selector', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="TEAM_LEADER"
        />,
      );

      await waitFor(() => {
        expect(mockApi.getMyTeams).toHaveBeenCalled();
      });

      const teamSelect = await screen.findByLabelText(/チーム/);
      expect(within(teamSelect as HTMLElement).getByText('チームA')).toBeInTheDocument();
      expect(within(teamSelect as HTMLElement).getByText('チームB')).toBeInTheDocument();
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

    it('displays displayName and team column in the list', async () => {
      const hook = createMockHook({
        models: [
          {
            modelName: 'model-alpha',
            modelStatus: 'COMPLETED',
            baseModelName: 'NarrowBand',
            displayName: '営業ドメイン',
            teamId: 'team-1',
          },
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

      const modelList = screen.getByRole('list', { name: 'カスタム言語モデル一覧' });
      // displayName shown as the primary (editable) label.
      expect(within(modelList).getByText('営業ドメイン')).toBeInTheDocument();
      // The raw Transcribe modelName is still visible.
      expect(within(modelList).getByText(/model-alpha/)).toBeInTheDocument();
      // Team name resolved from the team list.
      await waitFor(() => {
        expect(within(modelList).getByText(/チームA/)).toBeInTheDocument();
      });
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
    it('renders model name, display name, team selector, base model, and session list', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(screen.getByLabelText(/モデル名/)).toBeInTheDocument();
      expect(screen.getByLabelText('表示名 *')).toBeInTheDocument();
      await screen.findByLabelText(/チーム/);
      expect(screen.getByText('ベースモデル')).toBeInTheDocument();
      expect(screen.getByText('NarrowBand')).toBeInTheDocument();
      expect(screen.getByText('WideBand')).toBeInTheDocument();
      expect(screen.getByText('対象校閲セッション')).toBeInTheDocument();
      expect(screen.getByText('会議セッション A')).toBeInTheDocument();
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

    it('shows validation error when display name is empty', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.type(screen.getByLabelText(/モデル名/), 'valid-model');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(screen.getByText('表示名を入力してください。')).toBeInTheDocument();
    });

    it('shows validation error when no team is selected', async () => {
      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await screen.findByLabelText(/チーム/);
      await user.type(screen.getByLabelText(/モデル名/), 'valid-model');
      await user.type(screen.getByLabelText('表示名 *'), '営業ドメイン');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(screen.getByText('チームを選択してください。')).toBeInTheDocument();
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

      await screen.findByLabelText(/チーム/);
      await user.type(screen.getByLabelText(/モデル名/), 'valid-model');
      await user.type(screen.getByLabelText('表示名 *'), '営業ドメイン');
      await user.selectOptions(screen.getByLabelText(/チーム/), 'team-1');
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      expect(
        screen.getByText('対象の校閲セッションを1つ以上選択してください。'),
      ).toBeInTheDocument();
    });

    it('calls createModel with teamId, displayName and sessionIds on valid submission', async () => {
      const createModel = vi.fn().mockResolvedValue({
        modelName: 'new-model',
        displayName: '営業ドメイン',
        teamId: 'team-1',
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

      await screen.findByLabelText(/チーム/);
      await user.type(screen.getByLabelText(/モデル名/), 'new-model');
      await user.type(screen.getByLabelText('表示名 *'), '営業ドメイン');
      await user.selectOptions(screen.getByLabelText(/チーム/), 'team-1');
      await user.click(screen.getByRole('checkbox', { name: /会議セッション A/ }));
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      await waitFor(() => {
        expect(createModel).toHaveBeenCalledWith({
          modelName: 'new-model',
          baseModelName: 'NarrowBand',
          teamId: 'team-1',
          displayName: '営業ドメイン',
          sessionIds: ['session-1'],
        });
      });
    });

    it('shows success message after model creation', async () => {
      const createModel = vi.fn().mockResolvedValue({
        modelName: 'new-model',
        displayName: '営業ドメイン',
        teamId: 'team-1',
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

      await screen.findByLabelText(/チーム/);
      await user.type(screen.getByLabelText(/モデル名/), 'new-model');
      await user.type(screen.getByLabelText('表示名 *'), '営業ドメイン');
      await user.selectOptions(screen.getByLabelText(/チーム/), 'team-1');
      await user.click(screen.getByRole('checkbox', { name: /会議セッション A/ }));
      await user.click(screen.getByRole('button', { name: 'モデルを作成' }));

      await waitFor(() => {
        expect(screen.getByText(/モデル「営業ドメイン」の作成を開始しました/)).toBeInTheDocument();
      });
    });

    it('maps a QUOTA_EXCEEDED create error to a Japanese quota message', () => {
      const hook = createMockHook({
        createError: { code: 'QUOTA_EXCEEDED', message: 'Language model quota exceeded', statusCode: 429 },
      });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      expect(
        screen.getByText(/カスタム言語モデルの作成上限に達しています/),
      ).toBeInTheDocument();
    });
  });

  describe('row actions', () => {
    const completedModel = [
      {
        modelName: 'model-alpha',
        modelStatus: 'COMPLETED',
        baseModelName: 'NarrowBand',
        displayName: '営業ドメイン',
        teamId: 'team-1',
      },
    ];

    it('deletes a model after confirmation', async () => {
      const deleteModel = vi.fn().mockResolvedValue(true);
      const hook = createMockHook({ models: completedModel, deleteModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.click(screen.getByRole('button', { name: /モデル「営業ドメイン」を削除/ }));
      // Confirm dialog appears
      expect(screen.getByRole('alertdialog', { name: 'モデル削除の確認' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '削除する' }));

      await waitFor(() => {
        expect(deleteModel).toHaveBeenCalledWith('model-alpha');
      });
      expect(screen.getByText(/モデル「営業ドメイン」を削除しました/)).toBeInTheDocument();
    });

    it('cancels deletion when the confirm dialog is dismissed', async () => {
      const deleteModel = vi.fn();
      const hook = createMockHook({ models: completedModel, deleteModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.click(screen.getByRole('button', { name: /モデル「営業ドメイン」を削除/ }));
      await user.click(screen.getByRole('button', { name: 'キャンセル' }));

      expect(deleteModel).not.toHaveBeenCalled();
    });

    it('renames a model via the inline display-name editor', async () => {
      const renameModel = vi.fn().mockResolvedValue(null);
      const hook = createMockHook({ models: completedModel, renameModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="TEAM_LEADER"
        />,
      );

      await user.click(screen.getByRole('button', { name: 'セッション名を編集' }));
      const input = screen.getByLabelText('セッション名');
      await user.clear(input);
      await user.type(input, '新しい表示名');
      await user.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => {
        expect(renameModel).toHaveBeenCalledWith('model-alpha', '新しい表示名');
      });
    });

    it('shows the ADMIN-only team change control and changes team', async () => {
      const changeModelTeam = vi.fn().mockResolvedValue(null);
      const hook = createMockHook({ models: completedModel, changeModelTeam });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await screen.findByLabelText(/チーム/);
      await user.click(screen.getByRole('button', { name: 'チームを変更' }));
      await user.selectOptions(screen.getByLabelText('チームを変更'), 'team-2');
      await user.click(within(screen.getByRole('list', { name: 'カスタム言語モデル一覧' })).getByRole('button', { name: '保存' }));

      await waitFor(() => {
        expect(changeModelTeam).toHaveBeenCalledWith('model-alpha', 'team-2');
      });
    });

    it('does not show the team change control for TEAM_LEADER', () => {
      const hook = createMockHook({ models: completedModel });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="TEAM_LEADER"
        />,
      );

      expect(screen.queryByRole('button', { name: 'チームを変更' })).not.toBeInTheDocument();
    });

    it('surfaces a PENDING re-delete affordance for ADMIN when delete fails', async () => {
      const deleteModel = vi.fn().mockResolvedValue(false);
      const reDelete = vi.fn().mockResolvedValue(true);
      const hook = createMockHook({ models: completedModel, deleteModel, reDelete });

      render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await user.click(screen.getByRole('button', { name: /モデル「営業ドメイン」を削除/ }));
      await user.click(screen.getByRole('button', { name: '削除する' }));

      // Management view appears with a re-delete button.
      await waitFor(() => {
        expect(screen.getByText('削除保留中のモデル')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '再削除' }));

      await waitFor(() => {
        expect(reDelete).toHaveBeenCalledWith('model-alpha');
      });
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

    it('has no axe violations when rendered for ADMIN with models', async () => {
      const hook = createMockHook({
        models: [
          {
            modelName: 'model-alpha',
            modelStatus: 'COMPLETED',
            baseModelName: 'NarrowBand',
            displayName: '営業ドメイン',
            teamId: 'team-1',
          },
        ],
      });

      const { container } = render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={hook}
          sessions={mockSessions}
          userRole="ADMIN"
        />,
      );

      await screen.findByLabelText(/チーム/);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no axe violations on the access denied page', async () => {
      const { container } = render(
        <LanguageModelPage
          languageModelApi={mockApi}
          useLanguageModelsHook={mockHook}
          sessions={mockSessions}
          userRole="REVIEWER"
        />,
      );

      expect(screen.getByRole('main', { name: 'カスタム言語モデル管理' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
