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
 */
export async function updateCognitoUserRole(
  username: string,
  role: 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'
): Promise<void> {
  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [
        { Name: 'custom:role', Value: role },
      ],
    })
  );
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

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: userAttributes,
    })
  );
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
