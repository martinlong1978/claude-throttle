const WINDOW_SECONDS = 18000; // fixed 5h rate-limit window

function computeDelay({ usedPercentage, resetsAt, now, targetPct = 95, maxDelayS = 30 }) {
  const targetFraction = targetPct / 100;
  const usedFraction = usedPercentage / 100;
  const paceUsed = usedFraction / targetFraction;
  const idealRemaining = Math.max(0, (1 - paceUsed) * WINDOW_SECONDS);
  const actualRemaining = resetsAt - now;

  if (idealRemaining >= actualRemaining) return 0;
  return Math.min(actualRemaining - idealRemaining, maxDelayS);
}

module.exports = { computeDelay, WINDOW_SECONDS };
