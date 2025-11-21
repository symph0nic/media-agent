export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }

  // Binary math (1024) but labeled using common KB/MB/GB/TB for readability
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let idx = 0;

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }

  // For GiB/TiB show one decimal place to avoid aggressive rounding
  const precision = idx >= 3 ? 1 : value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

export function formatBytesDecimal(bytes) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let idx = 0;

  while (value >= 1000 && idx < units.length - 1) {
    value /= 1000;
    idx++;
  }

  const precision = idx >= 3 ? 1 : value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}
