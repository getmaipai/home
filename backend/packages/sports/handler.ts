// Today's MLB scores (step 7) - statsapi.mlb.com, MLB Advanced Media's
// own public stats API (the same one mlb.com's own site calls), no key.
// MLB only for now: no household sport/team preference setting exists
// yet, so this is honestly scoped to one league rather than guessing at
// a "your team" default that doesn't exist (the same honest-boundary
// call almanac-holiday made for its US-only holiday lookup). See
// almanac-date/handler.ts's own header for why this is Tier 1; see
// knowledge/handler.ts's own header for why this file has no import
// from anywhere outside its own directory and duplicates the
// host/fetch wire shape rather than sharing it.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

export interface Reply {
  text: string;
  speech: string;
}

interface MlbTeamSide {
  team?: { name?: string };
  score?: number;
}

interface MlbGame {
  status?: { abstractGameState?: string };
  teams?: { away?: MlbTeamSide; home?: MlbTeamSide };
}

interface MlbSchedule {
  dates?: { games?: MlbGame[] }[];
}

// Only a game that has actually started has a real score to report - a
// scheduled-but-not-yet-played game's score is always 0-0, which would
// otherwise read as a real (wrong) result.
function isReportable(game: MlbGame): game is MlbGame & {
  status: { abstractGameState: string };
  teams: { away: { team: { name: string }; score: number }; home: { team: { name: string }; score: number } };
} {
  const state = game.status?.abstractGameState;
  if (state !== "Live" && state !== "Final") return false;
  const away = game.teams?.away;
  const home = game.teams?.home;
  return (
    typeof away?.team?.name === "string" &&
    typeof away?.score === "number" &&
    typeof home?.team?.name === "string" &&
    typeof home?.score === "number"
  );
}

export function summarizeScores(data: unknown, count = 3): Reply {
  const games = (data as MlbSchedule | null)?.dates?.[0]?.games ?? [];
  const reportable = Array.isArray(games) ? games.filter(isReportable) : [];
  if (reportable.length === 0) {
    const text = "No MLB games have started yet today.";
    return { text, speech: text };
  }
  const lines = reportable.slice(0, count).map((game) => {
    const state = game.status.abstractGameState === "Final" ? "final" : "in progress";
    return `${game.teams.away.team.name} ${game.teams.away.score}, ${game.teams.home.team.name} ${game.teams.home.score} (${state})`;
  });
  const text = `${lines.join(". ")}.`;
  return { text, speech: text };
}

async function hostFetch(
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
  url: string,
): Promise<unknown> {
  const result = await extra.sendRequest({ method: "host/fetch", params: { url } }, z.object({ value: z.unknown() }));
  return result.value;
}

if (import.meta.main) {
  const server = new McpServer({ name: "sports", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: {} },
    async (_args: Record<string, never>, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      // Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident
      // and the five fixes"): a real fetch failure is reported as a
      // typed `error`, never a fabricated `reply` - the caller
      // (denoHost.ts's callTier1Handle()) decides the household-facing
      // fallback text (the manifest's own `fallback_reply`).
      try {
        const data = await hostFetch(extra, "https://statsapi.mlb.com/api/v1/schedule?sportId=1");
        const reply = summarizeScores(data);
        return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
      } catch (err) {
        const error = { code: "network_unreachable", message: err instanceof Error ? err.message : String(err) };
        return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      }
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
