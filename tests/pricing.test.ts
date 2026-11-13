import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, priceOf, tokensOf } from '../service/pricing.ts';

test('priceOf: the longest matching model prefix, dated snapshots included; unknown models have none', () => {
  assert.equal(priceOf('claude-opus-5-5')?.input, 4);
  assert.equal(priceOf('claude-opus-5')?.input, 5, 'claude-opus-5 is not claude-opus-5-5');
  assert.equal(priceOf('claude-opus-4-5-20251101')?.input, 5);
  assert.equal(priceOf('claude-opus-4-1-20250805')?.input, 15);
  assert.equal(priceOf('claude-fable-5-2')?.read, 0.2, 'cache reads are 0.025x on Fable 5.2');
  assert.equal(priceOf('claude-sonnet-5-5')?.read, 0.1);
  assert.equal(priceOf('gpt-5'), undefined);
});

test('tokensOf: the 5-minute and 1-hour cache writes from the split, or all as 5-minute without one', () => {
  assert.deepEqual(tokensOf({ input_tokens: 2, output_tokens: 131, cache_creation_input_tokens: 37883, cache_read_input_tokens: 40832, cache_creation: { ephemeral_1h_input_tokens: 37883, ephemeral_5m_input_tokens: 0 } }),
    { input: 2, output: 131, write5m: 0, write1h: 37883, read: 40832 });
  assert.deepEqual(tokensOf({ input_tokens: 5, cache_creation_input_tokens: 100 }), { input: 5, output: 0, write5m: 100, write1h: 0, read: 0 });
  assert.deepEqual(tokensOf(undefined), { input: 0, output: 0, write5m: 0, write1h: 0, read: 0 });
});

test('costOf: each kind of token at its own rate', () => {
  // Opus 5.5: $4 in, $20 out, 5m write $5, 1h write $8, read $0.20 per million
  const t = { input: 1e6, output: 1e6, write5m: 1e6, write1h: 1e6, read: 1e6 };
  assert.ok(Math.abs(costOf('claude-opus-5-5', t)! - (4 + 20 + 5 + 8 + 0.2)) < 1e-9);
  assert.equal(costOf('unknown', t), undefined);
});
