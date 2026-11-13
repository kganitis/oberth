import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The backup module reads the log of a backup script of your own (config.json "backup": { "log": … }). The format it
 * understands: a line `<date> <time> rsync exit <code>` per run, error lines in between, and optionally the results of
 * two daily steps, `<date> <time> snapshots exit <code>: <n> repos, <n> new, <n> failed` and the same for `restore check`.
 */
export const BACKUP_LOG = join(homedir(), 'Library/Logs/backup.log');

/** A daily step's last result: `snapshots exit 0: 12 repos, 2 new, 0 failed`, or the same for `restore check`. */
export interface BackupStep {
  exit: number;
  /** how many repos failed. The log names them but this doesn't, since some repos stay out of Oberth on purpose. */
  failed: number;
  at: number;
  /** undefined when the part of the log that was read has no clean run */
  lastCleanAt?: number;
}

export interface BackupStatus {
  exit: number;
  /** the last `rsync exit` line, as it stands in the log */
  line: string;
  at: number;
  /** undefined when the part of the log that was read has no clean run */
  lastCleanAt?: number;
  /** the last run's first error line */
  error?: string;
  /** undefined when the part of the log that was read has no such line */
  snapshots?: BackupStep;
  restore?: BackupStep;
}

/** The log's tail → the last run's result; null when it holds no `rsync exit` line. */
export function parseBackupLog(text: string): BackupStatus | null {
  const lines = text.split('\n');
  const time = (l: string): number => new Date(l.slice(0, 19).replace(' ', 'T')).getTime();
  let last: BackupStatus | null = null, lastCleanAt: number | undefined, runStart = 0, lastIndex = -1;
  const steps: { snapshots?: BackupStep; 'restore check'?: BackupStep } = {};
  lines.forEach((l, i) => {
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d start\b/.test(l)) runStart = i;
    const step = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (snapshots|restore check) exit (\d+): .*?(\d+) failed/.exec(l);
    if (step) {
      const name = step[1] as 'snapshots' | 'restore check', exit = Number(step[2]), at = time(l);
      steps[name] = { exit, failed: Number(step[3]), at, lastCleanAt: exit === 0 ? at : steps[name]?.lastCleanAt };
    }
    const m = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d rsync exit (\d+)\s*$/.exec(l);
    if (!m) return;
    last = { exit: Number(m[1]), line: l, at: time(l) };
    lastIndex = i;
    if (m[1] === '0') lastCleanAt = time(l);
  });
  if (!last) return null;
  const result: BackupStatus = last;
  const error = lines.slice(runStart, lastIndex).find((l) => /error|failed|: \S.*: /i.test(l) && !/^\d{4}-\d\d-\d\d /.test(l));
  return { ...result, lastCleanAt, error: result.exit ? error?.trim().slice(0, 300) : undefined, snapshots: steps.snapshots, restore: steps['restore check'] };
}

/** The backup's last result from the end of its log; null when the log is missing or doesn't parse. */
export function readBackupStatus(file = BACKUP_LOG, bytes = 256 * 1024): BackupStatus | null {
  try {
    const size = statSync(file).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
    return parseBackupLog(buf.toString('utf8'));
  } catch {
    return null;
  }
}
