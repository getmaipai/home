// The moon's current phase - one of the almanac's five small lookups
// (step 7). See almanac-date/handler.ts's own header for why this is
// Tier 1 and why it has zero required args.
//
// A well-known reference new moon (2000-01-06 18:14 UTC) and the
// synodic month's own average length - the standard approximation for
// "what phase is the moon in right now," accurate to within about a
// day, the right precision for a spoken answer. No network call, no
// household location needed: the moon's phase is the same everywhere on
// Earth at a given moment.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";

const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_DAYS = 29.530588853;
const MOON_PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

export function moonPhase(now: Date = new Date()): { text: string; speech: string } {
  const daysSinceNew = (now.getTime() - REFERENCE_NEW_MOON_MS) / 86_400_000;
  const cyclePosition = ((daysSinceNew % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const fraction = cyclePosition / SYNODIC_MONTH_DAYS;
  // Math.round, not Math.floor: a real gap found by code review - floor
  // starts each phase's own NAMED WINDOW exactly at its defining
  // astronomical moment (fraction 0 = new, 0.5 = full, ...) instead of
  // CENTERING the window on it, so for up to ~1.8 days before an actual
  // full moon the answer would still say "Waxing Gibbous" even though
  // the moon already looks essentially full - contrary to this file's
  // own "accurate to within about a day" claim just above. Rounding
  // instead puts the transition halfway between two consecutive named
  // moments, the way a person actually judges "close enough to call it
  // full."
  const name = MOON_PHASE_NAMES[Math.round(fraction * MOON_PHASE_NAMES.length) % MOON_PHASE_NAMES.length]!;
  const text = `The moon is in its ${name} phase.`;
  return { text, speech: text };
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-moon", version: "0.1.0" });
  server.registerTool("handle", { inputSchema: {} }, async () => {
    return { content: [{ type: "text", text: JSON.stringify({ reply: moonPhase(), actions: [] }) }] };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
