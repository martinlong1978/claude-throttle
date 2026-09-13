const test = require('node:test');
const assert = require('node:assert/strict');
const { formatSignedDuration } = require('../hooks/lib/format');

test('formats a positive duration with a leading plus', () => {
  assert.equal(formatSignedDuration(30), '+00:00:30');
});

test('formats a negative duration with a leading minus', () => {
  assert.equal(formatSignedDuration(-30), '-00:00:30');
});

test('formats zero as positive', () => {
  assert.equal(formatSignedDuration(0), '+00:00:00');
});

test('formats hours and minutes correctly', () => {
  assert.equal(formatSignedDuration(5873.7), '+01:37:54');
});

test('formats a negative multi-hour duration', () => {
  assert.equal(formatSignedDuration(-4500), '-01:15:00');
});

test('rounds fractional seconds to the nearest whole second', () => {
  assert.equal(formatSignedDuration(59.6), '+00:01:00');
});
