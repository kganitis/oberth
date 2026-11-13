import { get } from 'node:http';

import { stripAnsi } from './ansi.ts';
const LOCAL_URL = /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+[^\s)'"]*/;

const tidy = (u: string): string => u.replace(/[.,;]+$/, '').replace('//0.0.0.0:', '//localhost:');

/**
 * The page URL a dev server announced, local addresses only.
 * strong: labelled (Vite's "Local:", Hugo's "available at"); weak: the first bare local URL.
 */
export function findPageUrlDetail(output: string): { url: string; strong: boolean } | undefined {
  const text = stripAnsi(output);
  for (const label of [/Local:\s+/, /available at /]) {
    const m = new RegExp(label.source + `(${LOCAL_URL.source})`).exec(text);
    if (m) return { url: tidy(m[1]), strong: true };
  }
  const any = LOCAL_URL.exec(text);
  return any ? { url: tidy(any[0]), strong: false } : undefined;
}

export const findPageUrl = (output: string): string | undefined => findPageUrlDetail(output)?.url;

/** True if anything answers HTTP at url within timeoutMs (any status counts). Never throws. */
export function probe(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = get(url, (res) => { res.resume(); resolve(true); });
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}
