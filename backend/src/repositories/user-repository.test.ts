import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateUser } from './user-repository.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

describe('user-repository updateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({
      Attributes: {
        userId: 'user-001',
        email: 'new@example.com',
        displayName: 'New Name',
        role: 'REVIEWER',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    });
  });

  it('sets displayName in the update expression', async () => {
    await updateUser('user-001', { displayName: 'New Name' });

    const input = mockSend.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'USER#user-001', SK: 'METADATA' });
    expect(input.UpdateExpression).toContain('displayName = :displayName');
    expect(input.ExpressionAttributeValues[':displayName']).toBe('New Name');
  });

  it('rewrites GSI1PK when email changes', async () => {
    await updateUser('user-001', { email: 'new@example.com' });

    const input = mockSend.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('email = :email');
    expect(input.UpdateExpression).toContain('GSI1PK = :gsi1pk');
    expect(input.ExpressionAttributeValues[':email']).toBe('new@example.com');
    expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('EMAIL#new@example.com');
  });

  it('updates displayName and email together', async () => {
    await updateUser('user-001', {
      displayName: 'New Name',
      email: 'new@example.com',
    });

    const input = mockSend.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('displayName = :displayName');
    expect(input.UpdateExpression).toContain('email = :email');
    expect(input.UpdateExpression).toContain('GSI1PK = :gsi1pk');
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(input.ReturnValues).toBe('ALL_NEW');
  });

  it('still supports role and isActive updates', async () => {
    await updateUser('user-001', { role: 'ADMIN', isActive: false });

    const input = mockSend.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('#role = :role');
    expect(input.UpdateExpression).toContain('isActive = :isActive');
    expect(input.ExpressionAttributeNames['#role']).toBe('role');
    expect(input.ExpressionAttributeValues[':role']).toBe('ADMIN');
    expect(input.ExpressionAttributeValues[':isActive']).toBe(false);
  });
});
