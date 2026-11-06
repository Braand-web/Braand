import assert from 'node:assert/strict';
import test from 'node:test';
import {simulateAdBudget, simulatePriceChange, simulateMoreVisits, wilson} from '../lib/what-if.mjs';
import {siteSignals, recovered, signalTitle, WATCH_RULES} from '../lib/watch-core.mjs';

test('ad budget without a measured cost per result asks for it and proposes a small real test, never a guess', () => {
  const r = simulateAdBudget({dailyBudget: 5000, days: 14});
  assert.equal(r.status, 'needs_data');assert.equal(r.spend, 70000);assert.match(r.testPlan, /3 jours à 2500 FCFA par jour \(7500 FCFA\)/);
  assert.equal(r.projection, undefined);
});

test('ad budget with a cost per result gives a range, its sources, and sales and return when known', () => {
  const r = simulateAdBudget({dailyBudget: 5000, days: 14, costPerResult: 250, costSource: 'measured', resultLabel: 'messages', closeRate: 0.2, averageSale: 15000});
  assert.equal(r.status, 'ok');assert.deepEqual(r.projection, {unit: 'messages', low: 233, mid: 280, high: 350});
  assert.deepEqual(r.sales, {low: 46, mid: 56, high: 70});assert.equal(r.revenue.mid, 840000);assert.equal(r.return.mid, 12);
  assert.ok(r.assumptions.some(a => a.source === 'campagne mesurée'));assert.equal(r.confidence, 'moyenne');
  assert.equal(simulateAdBudget({dailyBudget: 1000, days: 10, costPerResult: 100}).confidence, 'faible', 'an estimate from memory is low confidence');
});

test('price change is exact break-even arithmetic, with no invented elasticity', () => {
  const up = simulatePriceChange({currentPrice: 10000, newPrice: 12000, monthlyUnits: 40, unitCost: 6000});
  assert.deepEqual(up.breakEven, {unitsNeeded: 27, volumeChangePercent: -32.5});assert.equal(up.sameVolume.profitNew, 240000);
  assert.match(up.explanation, /32\.5 % de moins/);
  const down = simulatePriceChange({currentPrice: 10000, newPrice: 9000, monthlyUnits: 40, unitCost: 6000});
  assert.deepEqual(down.breakEven, {unitsNeeded: 54, volumeChangePercent: 35});
  assert.equal(simulatePriceChange({currentPrice: 10000, newPrice: 5000, monthlyUnits: 40, unitCost: 6000}).status, 'blocked');
});

test('more visits uses the site’s measured contact rate with a Wilson interval, and refuses below 50 visitors', () => {
  const w = wilson(5, 200);assert.ok(w.low > 0 && w.low < 0.025 && w.high > 0.025 && w.high < 0.06);
  const r = simulateMoreVisits({extraVisits: 400, visitors: 200, leads: 5, days: 30, slug: 'mon-salon'});
  assert.equal(r.status, 'ok');assert.equal(r.projection.mid, 10);assert.ok(r.projection.low < 10 && r.projection.high > 10);assert.equal(r.confidence, 'moyenne');
  assert.equal(simulateMoreVisits({extraVisits: 400, visitors: 30, leads: 1, days: 30, slug: 'x'}).status, 'needs_data');
});

const days = (views, leads = () => 0) => Array.from({length: 17}, (_, i) => ({day: 'd' + i, views: views(i), leads: leads(i)}));
test('the watch raises a traffic drop only on a real fall with enough volume, and sees recovery', () => {
  const drop = siteSignals(days(i => i < 14 ? 20 : 8));
  assert.equal(drop.length, 1);assert.equal(drop[0].type, 'site_traffic_drop');assert.deepEqual(drop[0].facts, {usualViews3d: 60, lastViews3d: 24, changePercent: -60});
  assert.equal(siteSignals(days(i => i < 14 ? 5 : 1)).length, 0, 'too little volume: no alarm');
  assert.equal(siteSignals(days(i => i < 14 ? 20 : 16)).length, 0, 'a small dip is not a drop');
  assert.equal(siteSignals(days(() => 20).slice(0, 10)).length, 0);
  assert.equal(recovered('site_traffic_drop', drop[0].facts, 50, 0), true);assert.equal(recovered('site_traffic_drop', drop[0].facts, 30, 0), false);
  assert.match(signalTitle('site_traffic_drop', 'mon-salon', drop[0].facts), /« mon-salon » ont baissé de 60 %/);
  assert.equal(WATCH_RULES.minBaseline, 30);
});

test('the watch notices contact requests that stopped while visits continue', () => {
  const stopped = siteSignals(days(() => 20, i => i < 10 && i % 3 === 0 ? 1 : 0));
  assert.deepEqual(stopped.map(s => s.type), ['site_leads_stopped']);
  assert.equal(siteSignals(days(i => i < 10 ? 20 : 4, i => i < 10 && i % 3 === 0 ? 1 : 0)).some(s => s.type === 'site_leads_stopped'), false, 'fewer visits explain fewer requests');
  assert.equal(recovered('site_leads_stopped', {}, 0, 1), true);
});
