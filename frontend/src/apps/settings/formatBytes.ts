// Human-readable file size for the Backups list. Binary units (1024,
// not 1000): matches how every OS file browser and `du`/`ls -h` already
// show a backup's size, so the number on screen matches what a person
// sees looking at the file directly.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  let rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  // A code review (2026-09-04) found a real off-by-one-unit bug: rounding
  // happened before checking whether the ROUNDED value crosses into the
  // next unit. 1048575 bytes is 1023.999... KB, which fails the loop's
  // `>= 1024` check (so unitIndex stays at KB) but rounds to 1024 -
  // "1024 KB" instead of "1 MB". Re-check after rounding and promote once
  // more if needed.
  if (rounded >= 1024 && unitIndex < units.length - 1) {
    unitIndex += 1;
    value /= 1024;
    rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  }
  return `${rounded} ${units[unitIndex]}`;
}
