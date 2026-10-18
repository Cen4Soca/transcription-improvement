import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageModelApi } from './language-model-api';
import { ApiClient } from './api-client';

/**
 * Unit tests for LanguageModelApi — the team-isolation management surface
 * (create with teamId/displayName, delete, rename, team change, my-teams).
 *
 * Verifies each method calls the correct path / method / body on a mocked
 * ApiClient.
 */
describe('LanguageModelApi', () => {
  let api: LanguageModelApi;
  let mockClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      post: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      patch: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      delete: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    };
    api = new LanguageModelApi(mockClient as unknown as ApiClient);
  });

  it('listModels calls GET /language-models', async () => {
    await api.listModels();
    expect(mockClient.get).toHaveBeenCalledWith('/language-models');
  });

  it('createModel posts teamId and displayName in the body', async () => {
    await api.createModel({
      modelName: 'my-model',
      baseModelName: 'NarrowBand',
      teamId: 'team-1',
      displayName: '営業ドメイン',
      sessionIds: ['session-1'],
    });

    expect(mockClient.post).toHaveBeenCalledWith('/language-models', {
      modelName: 'my-model',
      baseModelName: 'NarrowBand',
      teamId: 'team-1',
      displayName: '営業ドメイン',
      sessionIds: ['session-1'],
    });
  });

  it('getModelStatus encodes the model name in the path', async () => {
    await api.getModelStatus('model a');
    expect(mockClient.get).toHaveBeenCalledWith('/language-models/model%20a');
  });

  it('deleteModel calls DELETE /language-models/{modelName}', async () => {
    await api.deleteModel('model-1');
    expect(mockClient.delete).toHaveBeenCalledWith('/language-models/model-1');
  });

  it('updateModelName PATCHes the /name sub-resource with { name }', async () => {
    await api.updateModelName('model-1', '新しい表示名');
    expect(mockClient.patch).toHaveBeenCalledWith('/language-models/model-1/name', {
      name: '新しい表示名',
    });
  });

  it('updateModelTeam PATCHes the /team sub-resource with { teamId }', async () => {
    await api.updateModelTeam('model-1', 'team-2');
    expect(mockClient.patch).toHaveBeenCalledWith('/language-models/model-1/team', {
      teamId: 'team-2',
    });
  });

  it('getMyTeams calls GET /me/teams', async () => {
    await api.getMyTeams();
    expect(mockClient.get).toHaveBeenCalledWith('/me/teams');
  });
});
