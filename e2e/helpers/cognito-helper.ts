import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
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
