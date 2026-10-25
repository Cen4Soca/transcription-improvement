/**
 * E2E テスト用 MediaFile シードデータ投入スクリプト
 *
 * S3 にダミーメディアファイルをアップロードし、
 * DynamoDB に MediaFile レコードを直接作成する。
 *
 * 使い方:
 *   cd e2e && npx tsx seed/seed-media-files.ts
 *
 * 前提:
 *   - .env に AWS_REGION, DYNAMODB_TABLE_NAME, MEDIA_BUCKET_NAME が設定済み
 *   - AWS プロファイルが設定済み（team_admin）
 *
 * 注意:
 *   - S3 アップロード後に process-upload Lambda が自動トリガーされるため、
 *     3秒待機してから DynamoDB レコードを上書きする
 *   - scanStatus: 'CLEAN' を設定しないと CloudFront 経由のアクセスがブロックされる
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'TranscriptionReviewApp';
const MEDIA_BUCKET = process.env.MEDIA_BUCKET_NAME!;
const REGION = process.env.AWS_REGION || 'ap-northeast-1';

if (!MEDIA_BUCKET) {
  console.error('❌ MEDIA_BUCKET_NAME が .env に設定されていません');
  process.exit(1);
}

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3 = new S3Client({ region: REGION });

// ============================================================
// Constants
// ============================================================

// ADMIN_USER_ID can be overridden via env so seeded media is owned by the real
// pre-registered Admin userId. Falls back to a fixed test id.
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'e2e-admin-user-001';
const TEAM_ID = 'e2e-team-001';

interface MediaSeedItem {
  mediaFileId: string;
  filename: string;
  contentType: string;
  sessionId: string;
  createdAt: string;
}

const SEED_ITEMS: MediaSeedItem[] = [
  {
    mediaFileId: 'e2e-media-001',
    filename: 'sample-audio.mp3',
    contentType: 'audio/mpeg',
    sessionId: 'e2e-session-001',
    createdAt: '2024-06-01T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-002',
    filename: 'sample-audio.wav',
    contentType: 'audio/wav',
    sessionId: 'e2e-session-002',
    createdAt: '2024-06-02T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-003',
    filename: 'sample-video.mp4',
    contentType: 'video/mp4',
    sessionId: 'e2e-session-003',
    createdAt: '2024-06-03T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-004',
    filename: 'sample-audio-for-delete.mp3',
    contentType: 'audio/mpeg',
    sessionId: 'e2e-session-004',
    createdAt: '2024-06-04T00:00:00.000Z',
  },
];

// ============================================================
// Dummy file generators (no ffmpeg dependency)
// ============================================================

/**
 * 最小限の有効な MP3 ファイル（無音フレーム）を生成する。
 * MPEG Audio Layer 3, 128kbps, 44100Hz, mono, 1フレーム分。
 */
function generateDummyMp3(): Buffer {
  // MP3 frame header: sync(11bit) + version(2) + layer(2) + protection(1)
  //                  + bitrate(4) + samplerate(2) + padding(1) + private(1)
  //                  + channelmode(2) + modeext(2) + copyright(1) + original(1) + emphasis(2)
  // MPEG1 Layer3 128kbps 44100Hz mono = 0xFFFB9004
  const frameHeader = Buffer.from([0xff, 0xfb, 0x90, 0x04]);
  // Frame size for 128kbps @ 44100Hz = 417 bytes (with padding varies)
  const frameSize = 417;
  const frameData = Buffer.alloc(frameSize - 4, 0); // zero-fill (silence)

  // Generate ~0.5 seconds of silence (about 19 frames)
  const frames: Buffer[] = [];
  for (let i = 0; i < 19; i++) {
    frames.push(frameHeader, frameData);
  }

  return Buffer.concat(frames);
}

/**
 * 最小限の WAV ファイル（無音）を生成する。
 * PCM 16bit, 44100Hz, mono, 0.5秒
 */
function generateDummyWav(): Buffer {
  const sampleRate = 44100;
  const bitsPerSample = 16;
  const numChannels = 1;
  const duration = 0.5; // seconds
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;         // sub-chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;          // PCM format
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), offset); offset += 4;
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  // Remaining bytes are already 0 (silence)

  return buffer;
}

/**
 * 最小限の MP4 ファイル（空コンテナ）を生成する。
 * ftyp + moov box のみ。再生はできないがファイルとしては有効。
 */
function generateDummyMp4(): Buffer {
  // ftyp box
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // size: 24 bytes
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // major_brand: 'isom'
    0x00, 0x00, 0x02, 0x00, // minor_version: 512
    0x69, 0x73, 0x6f, 0x6d, // compatible: 'isom'
    0x69, 0x73, 0x6f, 0x32, // compatible: 'iso2'
  ]);

  // Minimal moov box (empty movie)
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0); // size
  mvhd.write('mvhd', 4);     // type
  // rest is zeros (default values)

  const moovSize = 8 + mvhd.length;
  const moovHeader = Buffer.alloc(8);
  moovHeader.writeUInt32BE(moovSize, 0);
  moovHeader.write('moov', 4);

  return Buffer.concat([ftyp, moovHeader, mvhd]);
}

function generateDummyFileContent(contentType: string): Buffer {
  switch (contentType) {
    case 'audio/mpeg':
      return generateDummyMp3();
    case 'audio/wav':
      return generateDummyWav();
    case 'video/mp4':
      return generateDummyMp4();
    default:
      return Buffer.alloc(1024, 0);
  }
}

/**
 * メディアファイルの本体バイトを解決する。
 *
 * `e2e/seed/media-files/<filename>` に実ファイルが置かれていればそれを使い
 * （マニュアル用のリアルなスクリーンショットに有用）、無ければ再生可能な最小
 * ダミー（無音/空コンテナ）にフォールバックする。実ファイルを置けば、校閲画面の
 * メディアプレーヤーに実際の音声・動画が表示される。
 */
function getFileContent(filename: string, contentType: string): Buffer {
  const realPath = path.resolve(__dirname, 'media-files', filename);
  if (fs.existsSync(realPath)) {
    return fs.readFileSync(realPath);
  }
  return generateDummyFileContent(contentType);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🎵 E2E MediaFile シードデータ投入開始');
  console.log(`  Table:  ${TABLE_NAME}`);
  console.log(`  Bucket: ${MEDIA_BUCKET}`);
  console.log(`  Region: ${REGION}`);
  console.log('');

  for (const item of SEED_ITEMS) {
    const s3Key = `media/${item.mediaFileId}/${item.filename}`;
    const fileContent = getFileContent(item.filename, item.contentType);

    // 1. S3 にダミーファイルをアップロード
    console.log(`  [S3] Uploading: ${s3Key} (${fileContent.length} bytes)`);
    await s3.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: s3Key,
        Body: fileContent,
        ContentType: item.contentType,
      })
    );

    // 2. process-upload Lambda の自動トリガーを待つ
    console.log('        Waiting 3s for Lambda trigger...');
    await new Promise((r) => setTimeout(r, 3000));

    // 3. DynamoDB にレコードを上書き（テスト用フィールドで）
    console.log(`  [DDB] Writing: MEDIA#${item.mediaFileId}`);
    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `MEDIA#${item.mediaFileId}`,
          SK: 'METADATA',
          entityType: 'MediaFile',
          mediaFileId: item.mediaFileId,
          filename: item.filename,
          s3Key,
          s3Bucket: MEDIA_BUCKET,
          contentType: item.contentType,
          fileSize: fileContent.length,
          uploadedBy: ADMIN_USER_ID,
          teamId: TEAM_ID,
          status: 'COMPLETED',
          scanStatus: 'CLEAN',
          sessionId: item.sessionId,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
          uploadedAt: item.createdAt,
          GSI1PK: `TEAM#${TEAM_ID}`,
          GSI1SK: `MEDIA#${item.createdAt}#${item.mediaFileId}`,
          GSI2PK: `USER#${ADMIN_USER_ID}`,
          GSI2SK: `MEDIA#${item.createdAt}#${item.mediaFileId}`,
        },
      })
    );

    console.log(`        ✓ ${item.mediaFileId} 完了`);
    console.log('');
  }

  console.log(`🎵 MediaFile シードデータ投入完了 (${SEED_ITEMS.length} 件)`);
}

main().catch((err) => {
  console.error('❌ MediaFile シード投入失敗:', err);
  process.exit(1);
});
