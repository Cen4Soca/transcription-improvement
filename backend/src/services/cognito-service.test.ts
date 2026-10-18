import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class AdminUpdateUserAttributesCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminCreateUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminDisableUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminEnableUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminUserGlobalSignOutCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class AdminGetUserCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class CognitoIdentityProviderClient {
    send(...args: unknown[]): unknown {
      return mockSend(...args);
    }
  }
  return {
    CognitoIdentityProviderClient,
    AdminUpdateUserAttributesCommand,
    AdminCreateUserCommand,
    AdminDisableUserCommand,
    AdminEnableUserCommand,
    AdminUserGlobalSignOutCommand,
    AdminGetUserCommand,
  };
});

import { updateCognitoUserRole, updateCognitoUserAttributes } from './cognito-service.js';

/**
 * Build a Cognito-style error with a specific `name` and message, matching the
 * shape the AWS SDK throws (an Error whose `name` is the service error code).
 */
function cognitoError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('cognito-service: updateCognitoUserRole (shared-pool resilience)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('(a) resolves and issues AdminUpdateUserAttributes with custom:role when Cognito succeeds', async () => {
    mockSend.mockResolvedValue({});

    await expect(
      updateCognitoUserRole('reviewer@example.com', 'TEAM_LEADER')
    ).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.UserAttributes).toEqual([
      { Name: 'custom:role', Value: 'TEAM_LEADER' },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(b) does NOT throw and logs a warning when the attribute is not in the schema', async () => {
    mockSend.mockRejectedValue(
      cognitoError(
        'InvalidParameterException',
        'Attribute does not exist in the schema.'
      )
    );

    await expect(
      updateCognitoUserRole('reviewer@example.com', 'ADMIN')
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('(c) does NOT throw when Cognito rejects with a NotAuthorizedException referencing the attribute', async () => {
    mockSend.mockRejectedValue(
      cognitoError(
        'NotAuthorizedException',
        'A client attempted to write unauthorized attribute custom:role.'
      )
    );

    await expect(
      updateCognitoUserRole('reviewer@example.com', 'ADMIN')
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('(d) rethrows a genuine UserNotFoundException (no blanket swallow)', async () => {
    mockSend.mockRejectedValue(
      cognitoError('UserNotFoundException', 'User does not exist.')
    );

    await expect(
      updateCognitoUserRole('ghost@example.com', 'ADMIN')
    ).rejects.toThrow('User does not exist.');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(d) rethrows an InvalidParameterException that does NOT reference the attribute/schema', async () => {
    mockSend.mockRejectedValue(
      cognitoError('InvalidParameterException', 'Invalid user pool id provided.')
    );

    await expect(
      updateCognitoUserRole('reviewer@example.com', 'ADMIN')
    ).rejects.toThrow('Invalid user pool id provided.');

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('cognito-service: updateCognitoUserAttributes (shared-pool resilience)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('(e) tolerates a missing custom:displayName attribute and logs a warning', async () => {
    mockSend.mockRejectedValue(
      cognitoError(
        'InvalidParameterException',
        'Attribute does not exist in the schema.'
      )
    );

    await expect(
      updateCognitoUserAttributes('reviewer@example.com', { displayName: 'New Name' })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('(e) rethrows an email-related failure (not a custom-attribute case)', async () => {
    mockSend.mockRejectedValue(
      cognitoError('AliasExistsException', 'An account with the email already exists.')
    );

    await expect(
      updateCognitoUserAttributes('reviewer@example.com', { email: 'taken@example.com' })
    ).rejects.toThrow('An account with the email already exists.');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(e) rethrows UserNotFoundException', async () => {
    mockSend.mockRejectedValue(
      cognitoError('UserNotFoundException', 'User does not exist.')
    );

    await expect(
      updateCognitoUserAttributes('ghost@example.com', { displayName: 'Ghost' })
    ).rejects.toThrow('User does not exist.');

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
