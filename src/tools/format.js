export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let idx = 0;

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }

  const precision = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}
