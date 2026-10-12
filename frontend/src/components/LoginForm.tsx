import { useState } from 'react';
import { signIn, confirmSignIn, type SignInOutput } from 'aws-amplify/auth';

type LoginStep = 'SIGN_IN' | 'NEW_PASSWORD' | 'TOTP_SETUP' | 'TOTP_CODE';

/**
 * LoginForm - カスタムログインフォーム
 *
 * Amplify の <Authenticator> コンポーネントを使わず、signIn API を直接呼び出す。
 * これにより Cognito Hosted UI へのリダイレクトを完全に回避し、
 * 共有 User Pool Client の OAuth 設定に影響されずに SRP 認証を行う。
 */
export function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [step, setStep] = useState<LoginStep>('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn({ username: email, password });
      handleSignInResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      handleSignInResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'パスワード変更に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTotpCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await confirmSignIn({ challengeResponse: totpCode });
      handleSignInResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA認証に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSignInResult(result: SignInOutput) {
    if (result.isSignedIn) {
      onAuthenticated();
      return;
    }

    const nextStep = result.nextStep?.signInStep;
    switch (nextStep) {
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        setStep('NEW_PASSWORD');
        break;
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        setStep('TOTP_CODE');
        break;
      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP':
        setStep('TOTP_SETUP');
        break;
      default:
        setError(`未対応の認証ステップ: ${nextStep}`);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <h2 className="text-center text-2xl font-bold text-gray-900">
          Transcription Review App
        </h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {step === 'SIGN_IN' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2 border"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2 border"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        )}

        {step === 'NEW_PASSWORD' && (
          <form onSubmit={handleNewPassword} className="space-y-4">
            <p className="text-sm text-gray-600">
              初回ログインのため、新しいパスワードを設定してください。
            </p>
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                新しいパスワード
              </label>
              <input
                id="new-password"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2 border"
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-gray-500">
                8文字以上、大文字・小文字・数字・記号を含む
              </p>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? '設定中...' : 'パスワードを設定'}
            </button>
          </form>
        )}

        {step === 'TOTP_CODE' && (
          <form onSubmit={handleTotpCode} className="space-y-4">
            <p className="text-sm text-gray-600">
              認証アプリに表示されている6桁のコードを入力してください。
            </p>
            <div>
              <label htmlFor="totp-code" className="block text-sm font-medium text-gray-700">
                MFA コード
              </label>
              <input
                id="totp-code"
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2 border"
                autoComplete="one-time-code"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? '認証中...' : '認証'}
            </button>
          </form>
        )}

        {step === 'TOTP_SETUP' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              MFAの初期設定が必要です。管理者に連絡してください。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
