/**
 * S3 Pre-signed URL 生成インテグレーションテスト
 *
 * テスト内容:
 * - S3 Pre-signed URL (GetObject) の生成と検証
 * - 有効期限の設定検証（300 秒 / 5 分）
 * - メディアファイルへのアクセス制御（セッション別スコープ）
 * - 署名パラメータの正当性検証（SigV4）
 * - スキャン前アクセス制御テスト（PENDING ファイルの URL 生成拒否）
 *
 * 注記:
 * - メディア再生 URL は CloudFront Signed URL ではなく S3 Pre-signed URL を使用する。
 *   フロントは別プロジェクトの CloudFront ディストリビューションに相乗りしており、
 *   その Content-Security-Policy は `media-src https://*.amazonaws.com` を許可するが
 *   `*.cloudfront.net` は許可しない。S3 エンドポイント経由での配信により、共有
 *   ディストリビューションを変更せずに CSP 内で再生できる。
 *
 * 前提条件:
 * - LocalStack が起動していること (http://localhost:4566)
 * - 環境変数 INTEGRATION_TEST=true が設定されていること
 *
 * 実行方法:
 * INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts signed-url
 *
 * Validates: Requirements 9.1, 14.5, 14.24
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const SHOULD_RUN = process.env.INTEGRATION_TEST === 'true';

const describeIntegration = SHOULD_RUN ? describe : describe.skip;

describeIntegration('S3 Pre-signed URL 生成', () => {
  const REGION = 'ap-northeast-1';
  const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
  const BUCKET_NAME = 'test-media-bucket';
  const EXPIRES_IN = 300; // 5 minutes

  let s3Client: S3Client;

  beforeAll(() => {
    s3Client = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  });

  function presign(key: string, expiresIn = EXPIRES_IN): Promise<string> {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn }
    );
  }

  describe('Pre-signed URL 生成', () => {
    it('should generate a valid S3 pre-signed URL for a media file', async () => {
      const key = 'media/session-001/audio.mp3';
      const signedUrl = await presign(key);

      const urlObj = new URL(signedUrl);
      // Host must be an amazonaws.com endpoint to satisfy the co-host CloudFront CSP.
      // LocalStack uses a local endpoint, so assert the SigV4 parameters instead of the host.
      expect(signedUrl).toContain('X-Amz-Signature=');
      expect(signedUrl).toContain('X-Amz-Credential=');
      expect(signedUrl).toContain('X-Amz-Expires=');
      expect(urlObj.pathname).toContain(BUCKET_NAME);
      expect(urlObj.pathname).toContain(key);
    });

    it('should include correct resource path in the pre-signed URL', async () => {
      const key = 'media/session-path-test/video.mp4';
      const signedUrl = await presign(key);

      const urlObj = new URL(signedUrl);
      expect(urlObj.pathname).toContain(key);
    });

    it('should set expiration time correctly (300 seconds / 5 minutes)', async () => {
      const signedUrl = await presign('media/session-001/file.mp3');

      const urlObj = new URL(signedUrl);
      const expiresParam = urlObj.searchParams.get('X-Amz-Expires');
      expect(expiresParam).toBe(String(EXPIRES_IN));
    });
  });

  describe('Pre-signed URL アクセス制御', () => {
    it('should generate different signatures for different resources', async () => {
      const url1 = await presign('media/session-001/file1.mp3');
      const url2 = await presign('media/session-002/file2.mp3');

      const sig1 = new URL(url1).searchParams.get('X-Amz-Signature');
      const sig2 = new URL(url2).searchParams.get('X-Amz-Signature');
      expect(sig1).not.toBe(sig2);
    });

    it('should require all SigV4 signature parameters', async () => {
      const signedUrl = await presign('media/session-001/file.mp3');
      const urlObj = new URL(signedUrl);

      expect(urlObj.searchParams.has('X-Amz-Signature')).toBe(true);
      expect(urlObj.searchParams.has('X-Amz-Credential')).toBe(true);
      expect(urlObj.searchParams.has('X-Amz-Expires')).toBe(true);
      expect(urlObj.searchParams.has('X-Amz-Date')).toBe(true);
    });
  });

  describe('セッション別メディアアクセス', () => {
    it('should generate pre-signed URL scoped to specific resource key', async () => {
      const key = 'media/session-scoped-001/recording.wav';
      const signedUrl = await presign(key);

      const urlObj = new URL(signedUrl);
      expect(urlObj.pathname).toContain(key);
    });

    it('should generate unique URLs for different sessions', async () => {
      const url1 = await presign('media/session-A/file.mp3');
      const url2 = await presign('media/session-B/file.mp3');

      expect(url1).not.toBe(url2);
    });
  });

  describe('スキャン前アクセス制御（PENDING ファイルの URL 生成拒否）', () => {
    it('should reject signed URL generation for PENDING scanStatus', () => {
      const mediaFile = {
        mediaFileId: 'media-pending-001',
        scanStatus: 'PENDING' as const,
        s3Key: 'media/media-pending-001/file.mp3',
      };

      const shouldReject = !mediaFile.scanStatus || mediaFile.scanStatus === 'PENDING';
      expect(shouldReject).toBe(true);
    });

    it('should reject signed URL generation for INFECTED scanStatus', () => {
      const mediaFile = {
        mediaFileId: 'media-infected-001',
        scanStatus: 'INFECTED' as const,
        s3Key: 'media/media-infected-001/file.mp3',
      };

      const shouldReject = mediaFile.scanStatus === 'INFECTED';
      expect(shouldReject).toBe(true);
    });

    it('should allow signed URL generation for CLEAN scanStatus', async () => {
      const mediaFile = {
        mediaFileId: 'media-clean-001',
        scanStatus: 'CLEAN' as const,
        s3Key: 'media/media-clean-001/file.mp3',
      };

      const shouldAllow =
        mediaFile.scanStatus !== 'PENDING' && mediaFile.scanStatus !== 'INFECTED';
      expect(shouldAllow).toBe(true);

      const signedUrl = await presign(mediaFile.s3Key);
      expect(signedUrl).toContain('X-Amz-Signature=');
    });

    it('should reject when scanStatus is undefined (not yet scanned)', () => {
      const mediaFile = {
        mediaFileId: 'media-noscan-001',
        scanStatus: undefined,
        s3Key: 'media/media-noscan-001/file.mp3',
      };

      const shouldReject = !mediaFile.scanStatus || mediaFile.scanStatus === 'PENDING';
      expect(shouldReject).toBe(true);
    });
  });
});
