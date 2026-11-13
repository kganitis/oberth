export interface LiveStatus { ok: boolean; status?: number; ms?: number; error?: string; checkedAt: number }

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 8000;

/** One check of a live site: HEAD first, GET when a server refuses HEAD. Never throws. Shared with the outside-world checks. */
export async function checkLive(url: string, fetchImpl: typeof fetch = fetch): Promise<LiveStatus> {
  const start = Date.now();
  const go = (method: string) => fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    // only the status matters: cancel each body, or Node keeps the stream and its socket until GC
    const drop = (r: Response) => r.body?.cancel().catch(() => {});
    let r = await go('HEAD');
    if (r.status === 405 || r.status === 501) { await drop(r); r = await go('GET'); }
    await drop(r);
    return { ok: r.status < 400, status: r.status, ms: Date.now() - start, checkedAt: Date.now() };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timed out' : String(e?.cause?.code ?? e?.message ?? e), checkedAt: Date.now() };
  }
}

/**
 * Checks that live sites answer, at most once per TTL per URL, and only when asked (the dashboard asks).
 * HEAD first, GET when a server refuses HEAD. Plain requests: no token, cookie or project data is sent.
 */
export class LiveChecker {
  private results = new Map<string, LiveStatus>();
  private inFlight = new Set<string>();
  private fetchImpl: typeof fetch;
  private ttlMs: number;

  constructor(fetchImpl: typeof fetch = fetch, ttlMs = TTL_MS) { this.fetchImpl = fetchImpl; this.ttlMs = ttlMs; }

  get(url: string): LiveStatus | undefined { return this.results.get(url); }

  /** Starts a check if the last one is older than the TTL; never waits, never throws. */
  refresh(url: string, now = Date.now()): void {
    const last = this.results.get(url);
    if (this.inFlight.has(url) || (last && now - last.checkedAt < this.ttlMs)) return;
    this.inFlight.add(url);
    void this.check(url).then((r) => { this.results.set(url, r); this.inFlight.delete(url); });
  }

  private check(url: string): Promise<LiveStatus> { return checkLive(url, this.fetchImpl); }
}
