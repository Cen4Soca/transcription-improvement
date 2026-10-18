import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

/**
 * Detect the narrow class of Cognito errors that mean a custom attribute
 * (e.g. `custom:role` / `custom:displayName`) is not defined / not writable
 * on the User Pool. This happens when the app shares a pool (e.g. with GenU)
 * that was not provisioned with these custom attributes.
 *
 * Returns true ONLY for `InvalidParameterException` / `NotAuthorizedException`
 * whose message references the schema or custom attribute. Returns false for
 * everything else (`UserNotFoundException`, throttling, network errors, and
 * unrelated `InvalidParameterException`s) so those still surface as failures.
 */
function isMissingCustomAttributeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.name !== 'InvalidParameterException' &&
    error.name !== 'NotAuthorizedException'
  ) {
    return false;
  }

  const message = error.message.toLowerCase();
  const attributeMarkers = ['schema', 'attribute', 'custom:role', 'custom:displayname'];
  return attributeMarkers.some((marker) => message.includes(marker));
}

export interface CreateCognitoUserInput {
  email: string;
  displayName: string;
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
}

/**
 * Create a new user in Cognito User Pool.
 * Sets custom attributes for role and displayName.
 * Sends an invitation email with temporary password.
 */
export async function createCognitoUser(input: CreateCognitoUserInput): Promise<void> {
  await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: input.email,
      UserAttributes: [
        { Name: 'email', Value: input.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:displayName', Value: input.displayName },
        { Name: 'custom:role', Value: input.role },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    })
  );
}

/**
 * Disable a user in Cognito User Pool.
 * Prevents the user from logging in.
 */
export async function disableCognitoUser(username: string): Promise<void> {
  await cognitoClient.send(
    new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );
}

/**
 * Enable a previously disabled user in Cognito User Pool.
 * Allows the user to log in again.
 */
export async function enableCognitoUser(username: string): Promise<void> {
  await cognitoClient.send(
    new AdminEnableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );
}

/**
 * Sign out a user from all sessions in Cognito.
 * Invalidates all existing tokens immediately.
 */
export async function globalSignOutCognitoUser(username: string): Promise<void> {
  await cognitoClient.send(
    new AdminUserGlobalSignOutCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );
}

/**
 * Update user attributes in Cognito via AdminUpdateUserAttributes API.
 * This is the only way to change the custom:role attribute since it is
 * configured as non-mutable for end users (Req 14.18).
 *
 * Shared-pool tolerance: when the app shares a User Pool (e.g. with GenU) that
 * does NOT define the `custom:role` attribute, this write is best-effort.
 * Roles are resolved from DynamoDB (the source of truth) in that mode, so a
 * "missing attribute" Cognito error is logged as a warning and swallowed
 * instead of failing the request. Genuine errors (e.g. UserNotFoundException,
 * throttling) still propagate.
 */
export async function updateCognitoUserRole(
  username: string,
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'
): Promise<void> {
  try {
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [
          { Name: 'custom:role', Value: role },
        ],
      })
    );
  } catch (error: unknown) {
    if (isMissingCustomAttributeError(error)) {
      console.warn(
        'Cognito custom:role attribute is not defined on the User Pool; ' +
          'role change persisted in DynamoDB only (shared-pool mode).',
        error instanceof Error ? error.message : undefined
      );
      return;
    }
    throw error;
  }
}

export interface UpdateCognitoUserAttributesInput {
  displayName?: string;
  email?: string;
}

/**
 * Update a user's profile attributes (displayName and/or email) in Cognito
 * via the AdminUpdateUserAttributes API.
 *
 * When the email is changed, email_verified is set to 'true' so the user is
 * not forced through re-verification. Note that in pools where email is the
 * sign-in identifier, changing it affects how the user signs in.
 */
export async function updateCognitoUserAttributes(
  username: string,
  input: UpdateCognitoUserAttributesInput
): Promise<void> {
  const userAttributes: { Name: string; Value: string }[] = [];

  if (input.displayName !== undefined) {
    userAttributes.push({ Name: 'custom:displayName', Value: input.displayName });
  }

  if (input.email !== undefined) {
    userAttributes.push({ Name: 'email', Value: input.email });
    userAttributes.push({ Name: 'email_verified', Value: 'true' });
  }

  if (userAttributes.length === 0) {
    return;
  }

  try {
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: userAttributes,
      })
    );
  } catch (error: unknown) {
    if (isMissingCustomAttributeError(error)) {
      console.warn(
        'Cognito custom:displayName attribute is not defined on the User Pool; ' +
          'profile change persisted in DynamoDB only (shared-pool mode).',
        error instanceof Error ? error.message : undefined
      );
      return;
    }
    throw error;
  }
}

export interface CognitoUserInfo {
  email: string;
  displayName: string | null;
  enabled: boolean;
}

/**
 * Look up a user in Cognito User Pool by username (email).
 * Read-only operation — does not modify the user.
 * Returns null if the user does not exist.
 */
export async function lookupCognitoUser(username: string): Promise<CognitoUserInfo | null> {
  try {
    const response = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    const attributes = response.UserAttributes ?? [];
    const emailAttr = attributes.find((a) => a.Name === 'email');
    const displayNameAttr = attributes.find((a) => a.Name === 'custom:displayName');

    return {
      email: emailAttr?.Value ?? username,
      displayName: displayNameAttr?.Value ?? null,
      enabled: response.Enabled ?? true,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      return null;
    }
    throw error;
  }
}
