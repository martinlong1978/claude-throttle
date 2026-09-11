const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDelay } = require('../hooks/lib/calc');

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
