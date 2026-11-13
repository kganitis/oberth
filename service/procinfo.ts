import { execFile } from 'node:child_process';

/** Resident memory of a whole process group in bytes; undefined when ps fails or the group is gone. */
export function groupRss(pgid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pgid=,rss='], { timeout: 2000 }, (err, out) => {
      if (err) return resolve(undefined);
      let kb = 0, seen = false;
      for (const line of out.split('\n')) {
        const [g, rss] = line.trim().split(/\s+/).map(Number);
        if (g === pgid) { kb += rss || 0; seen = true; }
      }
      resolve(seen ? kb * 1024 : undefined);
    });
  });
}
