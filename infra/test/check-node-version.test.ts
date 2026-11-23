import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-node-version.sh');

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'check-node-version-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function run(nvmrcContent: string, actualMajor: string) {
  const nvmrcPath = join(workDir, `nvmrc-${Math.random().toString(36).slice(2)}`);
  writeFileSync(nvmrcPath, nvmrcContent);
  return spawnSync('bash', [SCRIPT, nvmrcPath], {
    env: { ...process.env, NODE_MAJOR_OVERRIDE: actualMajor },
    encoding: 'utf-8',
  });
}

describe('Feature: nodejs-26-runtime-upgrade, Property 3: Node.js version check at deploy time', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   * The check passes only when the major declared in .nvmrc equals the runtime major.
   */
  it('exits 0 when the required major matches the actual major', () => {
    const result = run('26\n', '26');
    expect(result.status).toBe(0);
  });

  it('exits non-zero and reports both majors when actual is older than required (26 vs 24)', () => {
    const result = run('26\n', '24');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('26');
    expect(result.stderr).toContain('24');
  });

  it('exits non-zero and reports both majors when actual is newer than required (24 vs 26)', () => {
    const result = run('24\n', '26');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('24');
    expect(result.stderr).toContain('26');
  });

  it.each(['v26.13.1', '26.13.1', 'v26.13.1\n', '26'])(
    'extracts the major from .nvmrc format %j and treats it as a match',
    (content) => {
      expect(run(content, '26').status).toBe(0);
    },
  );

  it.each(['26\n', '26\n\n', '  26  \n', '26\r\n', 'v26.13.1 \n'])(
    'tolerates trailing newlines and whitespace in .nvmrc %j',
    (content) => {
      expect(run(content, '26').status).toBe(0);
      expect(run(content, '24').status).not.toBe(0);
    },
  );
});
