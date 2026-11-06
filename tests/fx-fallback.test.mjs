import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEcbReference, fxReference, ECB_REFERENCE_URL} from '../lib/fx-fallback.mjs';
import {parseBEACReference} from '../lib/model-rate-sources.mjs';
const now = Date.parse('2026-11-06T10:00:00Z');
const xml = (time = '2026-11-05', rate = '1.1212') => `<gesmes:Envelope><Cube><Cube time='${time}'><Cube currency='USD' rate='${rate}'/><Cube currency='JPY' rate='170.1'/></Cube></Cube></gesmes:Envelope>`;
const beac = '<span>USD/XAF</span><div id="middle">582.5503</div><div id="right">587.5463</div><p>Date de valeur : 05/11/2026</p>';

test('ECB backup converts through the fixed euro peg with a margin above BEAC spread', () => {
  const fx = parseEcbReference(xml(), now);
  assert.equal(fx.fxSource, ECB_REFERENCE_URL);
  assert.equal(fx.fxValueDate, '2026-11-05');
  assert.equal(fx.conversionBasis, 'ecb_eur_peg_reference');
  assert.equal(fx.usdXaf, Math.round(655.957 / 1.1212 * 1.005 * 10000) / 10000);
  assert.ok(fx.usdXaf > 655.957 / 1.1212 * 1.0043);
});

test('stale, future, ambiguous or absurd ECB references are refused', () => {
  for (const input of [xml('2026-10-20'), xml('2026-11-07'), xml('2026-02-30'), xml('2026-11-05', '9'), xml('2026-11-05', 'abc'), xml() + xml(), 'USD 1.12'])
    assert.throws(() => parseEcbReference(input, now));
});

test('BEAC stays first; ECB is used only when BEAC fails, and both failing still blocks', async () => {
  const seen = [];
  const read = pages => async url => {seen.push(url);if (pages[url] instanceof Error) throw pages[url];return pages[url];};
  assert.equal((await fxReference(read({'https://www.beac.int/': beac}), parseBEACReference, now)).fxSource, 'https://www.beac.int/');
  assert.deepEqual(seen, ['https://www.beac.int/']);
  assert.equal((await fxReference(read({'https://www.beac.int/': new Error('model_fx_http_530'), [ECB_REFERENCE_URL]: xml()}), parseBEACReference, now)).fxSource, ECB_REFERENCE_URL);
  await assert.rejects(() => fxReference(read({'https://www.beac.int/': new Error('model_fx_http_530'), [ECB_REFERENCE_URL]: new Error('down')}), parseBEACReference, now), /model_fx_http_530/);
});
