// CANARY-01: words for the Status page's health checks row.
export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not checked yet";
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "Last checked just now";
  if (minutes === 1) return "Last checked 1 minute ago";
  if (minutes < 60) return `Last checked ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `Last checked ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

export const GROUP_WORD = { fail: "Failed", pass: "Passed", unknown: "Not checked" } as const;
