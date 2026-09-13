function formatSignedDuration(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : '+';
  const abs = Math.round(Math.abs(totalSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

module.exports = { formatSignedDuration };
