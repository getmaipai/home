// Currency conversion (step 7) - api.frankfurter.dev, a free public
// exchange-rate API built on European Central Bank reference rates, no
// key. The compute step's restricted evaluator (step 4, backs `math`/
// `convert`) has no currency units and no live rates - mathjs's own
// unit system is fixed physical quantities, not something a plugin can
// extend safely (createUnit is disabled there on purpose, see
// spec/interpreters/ts/compute.ts's own header) - so this is a real
// Tier 1 package with its own tiny parser and its own network call,
// not another `compute` expression.
//
// Routing note: `convert` (step 7, physical units) already owns the
// literal pattern "convert *", and turnEngine.ts's route() gives a
// pattern-match tie to whichever package sorts first by id - "convert"
// before "currency" - so this package can't also answer to "convert *"
// without becoming unreachable behind it. It answers to "exchange *"
// instead, documented honestly in this package's own README rather than
// pretending "convert 5 dollars to euros" works.
//
// See almanac-date/handler.ts's own header for why this is Tier 1; see
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

// A small, curated set of everyday currency words - not an attempt at
// every ISO 4217 code. A bare three-letter token that isn't in this
// table is still accepted as a literal code (e.g. "sek") and left for
// the API itself to accept or reject; this table only exists so "100
// dollars to euros" (how a person actually talks) works without making
// them say "USD to EUR".
const CURRENCY_WORDS: Record<string, string> = {
  dollar: "USD",
  dollars: "USD",
  euro: "EUR",
  euros: "EUR",
  pound: "GBP",
  pounds: "GBP",
  yen: "JPY",
  franc: "CHF",
  francs: "CHF",
  yuan: "CNY",
  renminbi: "CNY",
  rupee: "INR",
  rupees: "INR",
  peso: "MXN",
  pesos: "MXN",
};

function resolveCurrency(token: string): string | null {
  const lower = token.toLowerCase();
  if (CURRENCY_WORDS[lower]) return CURRENCY_WORDS[lower];
  if (/^[a-zA-Z]{3}$/.test(token)) return token.toUpperCase();
  return null;
}

export interface ParsedConversion {
  amount: number;
  from: string;
  to: string;
}

export function parseCurrencyExpression(expression: string): ParsedConversion | null {
  const match = expression.trim().match(/^([\d.,]+)\s+([a-zA-Z]+)\s+(?:to|for|in)\s+([a-zA-Z]+)$/i);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const from = resolveCurrency(match[2]!);
  const to = resolveCurrency(match[3]!);
  if (!from || !to) return null;
  return { amount, from, to };
}

interface FrankfurterResponse {
  amount?: number;
  rates?: Record<string, number>;
}

export function summarizeConversion(data: unknown, parsed: ParsedConversion): Reply {
  const rate = (data as FrankfurterResponse | null)?.rates?.[parsed.to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    const text = `I couldn't find an exchange rate from ${parsed.from} to ${parsed.to}.`;
    return { text, speech: text };
  }
  const rounded = Math.round(rate * 100) / 100;
  const text = `${parsed.amount} ${parsed.from} is about ${rounded} ${parsed.to}.`;
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
  const server = new McpServer({
    name: "currency",
    version: "0.1.0",
  });
  server.registerTool(
    "handle",
    { inputSchema: { expression: z.string() } },
    async (args: { expression: string }, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      const parsed = parseCurrencyExpression(args.expression);
      let reply: Reply;
      if (!parsed) {
        const text = `I couldn't understand "${args.expression}" as an amount and two currencies.`;
        reply = { text, speech: text };
      } else {
        try {
          const url = `https://api.frankfurter.dev/v1/latest?from=${parsed.from}&to=${parsed.to}&amount=${parsed.amount}`;
          const data = await hostFetch(extra, url);
          reply = summarizeConversion(data, parsed);
        } catch {
          reply = { text: "I couldn't look that up right now.", speech: "I couldn't look that up right now." };
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
