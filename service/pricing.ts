// What Claude Code's turns would cost at Anthropic's API prices, from the usage the transcripts record. An estimate:
// a subscription bills none of it per token. Prices per million tokens, from the Claude API reference (2026-11-03).
// Cache writes cost 1.25x input for the 5-minute cache and 2x for the 1-hour one; cache reads are a fraction of input
// that differs by model (0.025x on Fable 5.1/5.2, 0.05x on Opus 5.5 and Sonnet 5.5, 0.1x elsewhere).

interface Price { input: number; output: number; read: number }
const p = (input: number, output: number, readShare = 0.1): Price => ({ input, output, read: input * readShare });

/** Longest prefix first, so claude-opus-5-5 wins over claude-opus-5. Dated snapshots (…-20251101) match their prefix. */
const PRICES: [string, Price][] = ([
  ['claude-fable-5-2', p(8, 40, 0.025)], ['claude-mythos-5-2', p(8, 40, 0.025)],
  ['claude-fable-5-1', p(10, 50, 0.025)], ['claude-mythos-5-1', p(10, 50, 0.025)],
  ['claude-fable-5', p(10, 50)], ['claude-mythos-5', p(10, 50)],
  ['claude-opus-5-5', p(4, 20, 0.05)], ['claude-opus-5', p(5, 25)],
  ['claude-opus-4-8', p(5, 25)], ['claude-opus-4-7', p(5, 25)], ['claude-opus-4-6', p(5, 25)], ['claude-opus-4-5', p(5, 25)],
  ['claude-opus-4-1', p(15, 75)], ['claude-opus-4', p(15, 75)],
  ['claude-sonnet-5-5', p(2, 10, 0.05)], ['claude-sonnet-5', p(2, 10)],
  ['claude-sonnet-4', p(3, 15)], ['claude-3-7-sonnet', p(3, 15)], ['claude-3-5-sonnet', p(3, 15)],
  ['claude-haiku-5-5', p(0.1, 0.5)], ['claude-haiku-4-5', p(1, 5)], ['claude-3-5-haiku', p(0.8, 4)],
] as [string, Price][]).sort((a, b) => b[0].length - a[0].length);

export const priceOf = (model: string): Price | undefined => PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];

/** Token counts of one or more responses, as the transcript's usage reports them. */
export interface Tokens { input: number; output: number; write5m: number; write1h: number; read: number }
export const noTokens = (): Tokens => ({ input: 0, output: 0, write5m: 0, write1h: 0, read: 0 });

/** A transcript usage object as Tokens. A cache write without the 5m/1h split counts as 5-minute. */
export function tokensOf(u: any): Tokens {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const split = u?.cache_creation;
  const write5m = split ? n(split.ephemeral_5m_input_tokens) : n(u?.cache_creation_input_tokens);
  const write1h = split ? n(split.ephemeral_1h_input_tokens) : 0;
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), write5m, write1h, read: n(u?.cache_read_input_tokens) };
}

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({ input: a.input + b.input, output: a.output + b.output, write5m: a.write5m + b.write5m, write1h: a.write1h + b.write1h, read: a.read + b.read });
export const totalTokens = (t: Tokens): number => t.input + t.output + t.write5m + t.write1h + t.read;

/** Dollars at API prices; undefined for a model with no known price. */
export function costOf(model: string, t: Tokens): number | undefined {
  const pr = priceOf(model);
  if (!pr) return undefined;
  return (t.input * pr.input + t.output * pr.output + t.write5m * pr.input * 1.25 + t.write1h * pr.input * 2 + t.read * pr.read) / 1e6;
}
