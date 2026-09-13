const WINDOW_SECONDS = 18000; // fixed 5h rate-limit window

function computePaceDiff({ usedPercentage, resetsAt, now, targetPct = 95 }) {
  const targetFraction = targetPct / 100;
  const usedFraction = usedPercentage / 100;
  const paceUsed = usedFraction / targetFraction;
  const idealRemaining = Math.max(0, (1 - paceUsed) * WINDOW_SECONDS);
  const actualRemaining = resetsAt - now;
  return actualRemaining - idealRemaining;
}

function computeDelay({ usedPercentage, resetsAt, now, targetPct = 95, maxDelayS = 30 }) {
  const diff = computePaceDiff({ usedPercentage, resetsAt, now, targetPct });
  if (diff <= 0) return 0;
  return Math.min(diff, maxDelayS);
}

module.exports = { computeDelay, computePaceDiff, WINDOW_SECONDS };
