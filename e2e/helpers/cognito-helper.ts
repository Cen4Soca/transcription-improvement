import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || 'ap-northeast-1',
});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;

/**
 * Cognito Admin SDK でログインし、IdToken を取得する
 */
export async function adminAuth(
  email: string,
  password: string
): Promise<{ idToken: string; accessToken: string }> {
  const res = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    })
  );

  if (!res.AuthenticationResult?.IdToken) {
    throw new Error(`Authentication failed for ${email}`);
  }

  return {
    idToken: res.AuthenticationResult.IdToken,
    accessToken: res.AuthenticationResult.AccessToken!,
  };
}

/**
 * ユーザーのパスワードを永続的に設定する（FORCE_CHANGE_PASSWORD 解除）
 */
export async function setUserPassword(
  email: string,
  password: string
): Promise<void> {
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );
}

/**
 * Create a Cognito user that stays in FORCE_CHANGE_PASSWORD state.
 *
 * The user is created with a temporary password and the welcome email
 * suppressed, and the password is NOT made permanent. Signing in with the
 * temporary password therefore triggers the NEW_PASSWORD_REQUIRED challenge,
 * which the app renders as the "新しいパスワードを設定" form. Used by auth
 * test 1.4. Caller must delete the user afterwards via deleteUser().
 */
export async function createForceChangePasswordUser(
  email: string,
  temporaryPassword: string
): Promise<void> {
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: temporaryPassword,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:role', Value: 'REVIEWER' },
        { Name: 'custom:displayName', Value: 'E2E 初回ログインユーザー' },
      ],
    })
  );
}

/**
 * Delete a Cognito user. Swallows errors so cleanup never fails a test.
 */
export async function deleteUser(email: string): Promise<void> {
  try {
    await client.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
  } catch {
    // ignore cleanup failures
  }
}
