import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
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

/**
 * Check whether a Cognito user exists. Returns the user's `sub` if present,
 * or null if the user does not exist.
 */
export async function getCognitoUserSub(email: string): Promise<string | null> {
  try {
    const res = await client.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
    const sub = res.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    return sub ?? null;
  } catch (err) {
    if (err instanceof Error && err.name === 'UserNotFoundException') {
      return null;
    }
    throw err;
  }
}

/**
 * Create a Cognito user WITHOUT sending any email (MessageAction: SUPPRESS),
 * with a confirmed permanent password and the given role, then return its `sub`.
 *
 * This is the email-free path used to provision the reusable fixed E2E test
 * users. Because no welcome/invite email is sent, it does not consume the
 * Cognito daily email quota. Idempotent: if the user already exists, the
 * existing sub is returned without re-creating.
 */
export async function ensureCognitoUser(params: {
  email: string;
  password: string;
  role: 'TEAM_LEADER' | 'REVIEWER' | 'ADMIN';
  displayName: string;
}): Promise<string> {
  const existing = await getCognitoUserSub(params.email);
  if (existing) {
    // Make sure the password is the expected permanent one (re-usable login).
    await setUserPassword(params.email, params.password);
    return existing;
  }

  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: params.email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: params.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:role', Value: params.role },
        { Name: 'custom:displayName', Value: params.displayName },
      ],
    })
  );
  await setUserPassword(params.email, params.password);

  const sub = await getCognitoUserSub(params.email);
  if (!sub) {
    throw new Error(`Failed to resolve sub for created user ${params.email}`);
  }
  return sub;
}
