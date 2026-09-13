const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDelay, computePaceDiff } = require('../hooks/lib/calc');

test('on pace or behind pace: no delay', () => {
  const now = 1000;
  const resetsAt = now + 14400; // 1h elapsed of 5h, 4h actual remaining
  const delay = computeDelay({ usedPercentage: 10, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 0);
});

test('ahead of pace: positive delay, capped', () => {
  const now = 1000;
  const resetsAt = now + 14400; // 1h elapsed, 4h left
  const delay = computeDelay({ usedPercentage: 50, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 30);
});

test('cap is respected at a different cap value', () => {
  const now = 0;
  const resetsAt = now + 17999;
  const delay = computeDelay({ usedPercentage: 94, resetsAt, now, targetPct: 95, maxDelayS: 5 });
  assert.equal(delay, 5);
});

test('hitting target percentage forces full throttle regardless of clock time left', () => {
  const now = 0;
  const resetsAt = now + 100;
  const delay = computeDelay({ usedPercentage: 95, resetsAt, now, targetPct: 95, maxDelayS: 30 });
  assert.equal(delay, 30);
});

test('boundary: exactly on pace at target yields zero delay', () => {
  const now = 0;
  const targetPct = 95;
  const usedPercentage = 47.5; // half of target
  const resetsAt = now + 9000; // idealRemaining works out to exactly 9000
  const delay = computeDelay({ usedPercentage, resetsAt, now, targetPct, maxDelayS: 30 });
  assert.equal(delay, 0);
});

test('computePaceDiff is positive (ahead of pace) matching the uncapped amount computeDelay would cap', () => {
  const now = 1000;
  const resetsAt = now + 14400; // 1h elapsed, 4h left
  const diff = computePaceDiff({ usedPercentage: 50, resetsAt, now, targetPct: 95 });
  // idealRemaining = (1 - (50/95))*18000 = 8526.31..., actualRemaining = 14400
  assert.ok(diff > 5800 && diff < 5900, `expected ~5873.7, got ${diff}`);
});

test('computePaceDiff is negative (behind pace) when comfortably under budget', () => {
  const now = 1000;
  const resetsAt = now + 14400;
  const diff = computePaceDiff({ usedPercentage: 10, resetsAt, now, targetPct: 95 });
  assert.ok(diff < 0, `expected negative, got ${diff}`);
});

test('computePaceDiff is zero exactly on pace at target', () => {
  const diff = computePaceDiff({ usedPercentage: 47.5, resetsAt: 9000, now: 0, targetPct: 95 });
  assert.equal(diff, 0);
});

test('computeDelay is the diff capped at maxDelayS, or 0 when diff is non-positive', () => {
  const now = 1000;
  const resetsAt = now + 14400;
  const diff = computePaceDiff({ usedPercentage: 50, resetsAt, now, targetPct: 95 });
  const delay = computeDelay({ usedPercentage: 50, resetsAt, now, targetPct: 95, maxDelayS: 3 });
  assert.equal(delay, 3);
  assert.ok(diff > 3);
});
