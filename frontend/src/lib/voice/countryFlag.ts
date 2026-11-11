/** Until the kit round-flag image element ships, use platform regional indicators. */
export function countryFlag(code: string | null): string {
  if (!code) return "🌐";
  const tags: Record<string, string> = { "GB-SCT": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "GB-WLS": "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "GB-NIR": "🏴󠁧󠁢󠁮󠁩󠁲󠁿" };
  if (tags[code]) return tags[code]!;
  const value = code === "GB" ? "GB" : code;
  return [...value.slice(0, 2).toUpperCase()].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");
}
