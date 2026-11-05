import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMeasuredMargin, designHeadroom, salesCommitments, REQUIRED_COST_CATEGORIES} from '../lib/production-economics.mjs';

const measured = () => ({
  recognizedRevenueXaf: 10000, revenueEvidence: 'fixture:revenue-net-of-refunds-and-taxes',
  costs: Object.fromEntries(REQUIRED_COST_CATEGORIES.map(key => [key, {amountXaf: 0, evidence: `fixture:${key}`}]))
});

test('missing costs and unexplained zeros cannot prove the production margin', () => {
  assert.equal(assessMeasuredMargin({}).status, 'BLOCKED');
  for (const key of REQUIRED_COST_CATEGORIES) {
    const data = measured(); delete data.costs[key];
    assert(assessMeasuredMargin(data).missing.includes(key));
    data.costs[key] = {amountXaf: 0};
    assert.equal(assessMeasuredMargin(data).eligible, false);
  }
});

test('measured margin counts all categories and rejects an offer below 75 percent', () => {
  const data = measured();
  data.costs.model.amountXaf = 2000; data.costs.payment.amountXaf = 500;
  assert.equal(assessMeasuredMargin(data).margin, .75);
  assert.equal(assessMeasuredMargin(data).eligible, true);
  data.costs.support.amountXaf = 1;
  assert.equal(assessMeasuredMargin(data).eligible, false);
  data.costs.support.amountXaf = -1;
  assert.equal(assessMeasuredMargin(data).status, 'BLOCKED');
});

test('new sales commitments include twelve months of annual costs, with no fake measured margin', () => {
  const pro = salesCommitments().find(row => row.id === 'pro:period');
  const annual=salesCommitments().find(row=>row.id==='pro:annual');
  assert.deepEqual([annual.grossXaf,annual.credits,annual.serviceMonths],[99000,3000,12]);
  assert.equal(designHeadroom(annual).status,'BLOCKED');
  assert.equal(pro.credits, 250);
  assert.equal(pro.serviceMonths, 1);
  assert.equal(designHeadroom(pro).status, 'BLOCKED');
  const scenario = designHeadroom(pro, {paymentFeeBps: 500, taxBps: 0});
  assert.equal(scenario.status, 'SCENARIO_ONLY');
  assert.equal(scenario.remainingVariableCostBudgetXaf, 980);
  assert.equal(scenario.margin, undefined);
});

test('a negative scenario headroom is preserved and all sales packs are included', () => {
  const commitments = salesCommitments();
  assert.equal(commitments.length, 11);
  for (const row of commitments.filter(row=>row.id.startsWith('enterprise:'))) assert(designHeadroom(row,{paymentFeeBps:350,taxBps:0}).remainingVariableCostBudgetXaf > 0, 'Entreprise keeps a positive design headroom');
  assert.deepEqual(commitments.filter(row=>row.id.startsWith('topup:')).map(row=>[row.credits,row.grossXaf]),[[50,2500],[125,5000],[300,10000]]);
  assert(designHeadroom({id:'test',grossXaf:100,credits:100}, {paymentFeeBps:0,taxBps:0}).remainingVariableCostBudgetXaf < 0);
  for (const invalid of [NaN, Infinity, -1, 10001]) {
    assert.equal(designHeadroom(commitments[0], {paymentFeeBps:invalid,taxBps:0}).status, 'BLOCKED');
  }
});
