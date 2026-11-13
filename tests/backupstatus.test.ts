import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { parseBackupLog, readBackupStatus } from '../service/backupstatus.ts';

const FAILED = `2026-11-03 10:30:00 start
2026-11-03 10:32:00 rsync exit 0
2026-11-03 10:40:00 evict done
2026-11-03 11:30:00 start
rsync(8475): error: some-lib/.git/logs/refs/remotes/origin/main: mmap: Resource deadlock avoided
rsync(8474): error: unexpected end of file
2026-11-03 11:31:00 rsync exit 1
`;

test('a log ending in a failed run gives the exit, the last clean run and the first error line', () => {
  const b = parseBackupLog(FAILED)!;
  assert.equal(b.exit, 1);
  assert.equal(b.lastCleanAt, new Date('2026-11-03T10:32:00').getTime());
  assert.match(b.error!, /mmap: Resource deadlock avoided/);
  assert.equal(b.line, '2026-11-03 11:31:00 rsync exit 1');
});

test('a clean last run has no error, even after earlier failures', () => {
  const b = parseBackupLog(`${FAILED}2026-11-03 12:30:00 start \n2026-11-03 12:31:00 rsync exit 0\n2026-11-03 12:33:00 evict done\n`)!;
  assert.equal(b.exit, 0);
  assert.equal(b.error, undefined);
  assert.equal(b.lastCleanAt, new Date('2026-11-03T12:31:00').getTime());
});

test('a log with no clean run has no lastCleanAt, and one with no exit line gives null', () => {
  assert.equal(parseBackupLog('2026-11-03 11:31:00 rsync exit 23\n')!.lastCleanAt, undefined);
  assert.equal(parseBackupLog('hello\nworld\n'), null);
  assert.equal(parseBackupLog(''), null);
});

test('readBackupStatus gives null for a missing file and reads only the end of a big one', () => {
  const dir = makeTree({ 'a.txt': '' });
  assert.equal(readBackupStatus(join(dir, 'none.log')), null);
  const file = join(dir, 'backup.log');
  writeFileSync(file, 'x'.repeat(5000) + '\n2026-11-03 11:31:00 rsync exit 0\n');
  assert.equal(readBackupStatus(file, 100)!.exit, 0);
});

test('the daily steps: the latest result of each, the last clean one, and the count of failures', () => {
  const b = parseBackupLog(`2026-11-03 10:32:00 rsync exit 0
2026-11-03 10:33:00 snapshots exit 0: 12 repos, 2 new, 0 failed
2026-11-03 10:34:00 restore check exit 0: 12 checked, 0 failed, 0 left
snapshot failed: some-repo: fatal: bad
2026-11-04 10:33:00 snapshots exit 1: 12 repos, 0 new, 2 failed
`)!;
  assert.deepEqual([b.snapshots!.exit, b.snapshots!.failed, b.snapshots!.at, b.snapshots!.lastCleanAt], [1, 2, new Date('2026-11-04T10:33:00').getTime(), new Date('2026-11-03T10:33:00').getTime()]);
  assert.deepEqual([b.restore!.exit, b.restore!.failed, b.restore!.lastCleanAt], [0, 0, new Date('2026-11-03T10:34:00').getTime()]);
  assert.equal(b.exit, 0);
  assert.equal(b.error, undefined);
  assert.equal(parseBackupLog('2026-11-03 10:32:00 rsync exit 0\n')!.snapshots, undefined);
});
