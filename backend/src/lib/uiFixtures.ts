import type { TurnStreamEvent, TurnValue } from "../wire";
import { failureLine, partialReplyNote } from "./failureCopy";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

// UI-SHOWCASE: canned turns for the admin's Chat showcase (/dev/ui). A fixture
// is an array of the same events POST /api/turn/stream releases (turn_meta,
// delta, reasoning, tool_call, tool_result, tool_error, status, spoken_cue,
// done, error); routes/devUi.ts runs them through the real assistant-stream
// sink (lib/assistantStreamWire.ts), so no frame is written by hand here.
type Event = TurnStreamEvent | ToolStreamEvent;

export interface UiFixture {
  id: string;
  title: string;
  description: string;
  events: Event[];
  /** THIN-1E: the stored failure behind this fixture's turn, so the admin's error-detail popover has a real row to read. */
  storedOutcomes?: unknown[];
  /** Milliseconds between events at "normal" and "slow"; "instant" is always 0. */
  pace?: { normal: number; slow: number };
}

export const DEFAULT_PACE = { normal: 30, slow: 140 } as const;

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-10-04T00:00:00.000Z" };

function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// A turn: meta, optional lead events, the text in small deltas, a done.
function turn(id: string, text: string, opts: { lead?: Event[]; reasoning?: string; size?: number; value?: Partial<TurnValue>; tail?: Event[] } = {}): Event[] {
  let sequence = 0;
  const events: Event[] = [{ type: "turn_meta", conversation_id: "showcase", turn_id: `showcase-${id}` }, ...(opts.lead ?? [])];
  if (opts.reasoning) for (const part of chunk(opts.reasoning, 40)) events.push({ type: "reasoning", text: part, sequence: ++sequence });
  for (const part of chunk(text, opts.size ?? 18)) events.push({ type: "delta", text: part, sequence: ++sequence });
  events.push(...(opts.tail ?? []));
  events.push({ type: "done", value: { reply: { text }, source: "model", safety: SAFE, conversation_id: "showcase", turn_id: `showcase-${id}`, ...opts.value } as TurnValue });
  return events;
}

// A turn that ends in the error event instead of done.
function failing(id: string, partial: string, error: Extract<TurnStreamEvent, { type: "error" }>): Event[] {
  const events = turn(id, partial);
  events.pop();
  return [...events, error];
}

const TABLE = `Here is the household chore rota for the week.

| Name | Monday | Wednesday | Saturday |
| --- | --- | --- | --- |
| Juniper | Dishes | Recycling | Vacuum |
| Oliver | Laundry | Dishes | Garden |
| Sprout | Feed the cat | Water plants | Tidy toys |
| Willow | Bins | Laundry | Dishes |

Everyone swaps one chore on Saturday.`;

const CODE = `Two small examples, one per language.

\`\`\`python
def greet(names: list[str]) -> str:
    """Return one friendly line for the household."""
    return ", ".join(f"Hello {n}" for n in names)

print(greet(["Juniper", "Oliver"]))
\`\`\`

\`\`\`typescript
interface Chore {
  name: string;
  done: boolean;
}

export const remaining = (chores: Chore[]): number => chores.filter((c) => !c.done).length;
\`\`\`

Use the copy button on either block.`;

const MATH = `Inline math: the area of a circle is $A = \\pi r^2$, and $e^{i\\pi} + 1 = 0$.

Block math, the quadratic formula:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

And a sum:

$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$`;

const LISTS = `A long list first:

${Array.from({ length: 14 }, (_, i) => `${i + 1}. Item number ${i + 1} on the packing list`).join("\n")}

Then nested lists:

- Groceries
  - Fruit
    - Apples
    - Pears
  - Dairy
    - Milk
    - Yoghurt
- Errands
  1. Post office
  2. Library
     - Return two books
     - Pick up the hold`;

const HEADINGS = `# Weekend plan

A short introduction under the top heading.

## Saturday

### Morning

Pancakes, then the market.

### Afternoon

> A quote from the fridge door: "Be kind, rewind, and put the milk back."
>
> Nested thought inside the same quote.

## Sunday

Slow day. **Bold**, *italic*, ~~struck~~ and \`inline code\` all in one line.

---

The end.`;

function essay(): string {
  const paragraph = "The kitchen is the quietest place in the house at six in the morning, and that is exactly why it is worth writing about. Light comes in low across the counter, the kettle ticks as it cools, and for a few minutes nobody needs anything. ";
  return Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}. ${paragraph}`).join("\n\n");
}

const SEARCH = `Short answer: the market opens at 8:00 on Saturdays [1], and the library keeps its usual hours [2]. Parking is free before 10:00 [1][3].`;

const MD_LINKS = `A link, a bare URL and a picture.

Read the [household handbook](https://example.com/handbook) or visit https://example.com directly.

![The MaiPai icon, served by the hub](/brand/pwa-icon-192.png)`;

const SOURCES = [
  { id: "src-market01", kind: "web", title: "Saturday market opening hours", url: "https://example.com/market", site: "example.com", created_at: "2026-10-04T00:00:00.000Z", source: "sync", hlc: "0" },
  { id: "src-library1", kind: "web", title: "Library hours and holidays", url: "https://example.org/library", site: "example.org", created_at: "2026-10-04T00:00:00.000Z", source: "sync", hlc: "0" },
  { id: "src-parking1", kind: "web", title: "Town parking rules", url: "https://example.net/parking", site: "example.net", created_at: "2026-10-04T00:00:00.000Z", source: "sync", hlc: "0" },
] as unknown as NonNullable<TurnValue["sources"]>;

const CRISIS = "If you are thinking about hurting yourself, you are not alone. In the US you can call or text 988 at any time to reach the Suicide & Crisis Lifeline.";

export const UI_FIXTURES: UiFixture[] = [
  { id: "table", title: "Table", description: "A markdown table with four columns and a closing line.", events: turn("table", TABLE) },
  { id: "code", title: "Code blocks", description: "Fenced Python and TypeScript blocks, each with its copy button.", events: turn("code", CODE) },
  { id: "math", title: "Math", description: "Inline and block LaTeX: a circle, the quadratic formula and a sum.", events: turn("math", MATH) },
  { id: "lists", title: "Lists", description: "A fourteen-item numbered list, then bullet and numbered lists nested three deep.", events: turn("lists", LISTS) },
  { id: "headings", title: "Headings and quote", description: "Three heading levels, a block quote, inline styles and a rule.", events: turn("headings", HEADINGS) },
  { id: "essay", title: "Long essay (30 s)", description: "A long reply that streams for about 30 seconds at Normal pace: press Stop part way through.", events: turn("essay", essay(), { size: 40 }), pace: { normal: 100, slow: 250 } },
  {
    id: "reasoning", title: "Reasoning then answer", description: "A reasoning block streams first, then the answer; the block rests closed as one line.",
    events: turn("reasoning", "Three people, two cars. Each car holds four, so two cars are plenty.", { reasoning: "The question asks how many cars are needed for three people. A car holds four. One car is enough, but they asked about two cars, so two is more than enough." }),
  },
  {
    id: "search", title: "Search with sources", description: "A cited answer with [1] [2] [3] markers, a lookup status line and the sources button.",
    events: turn("search", SEARCH, {
      lead: [
        { type: "status", stage: "lookup", text: "Looking that up" },
        { t: "tool_call", call_id: "call-search-1", package_id: "websearch", args: { q: "saturday market hours" }, label: "Searching the web" },
        { t: "tool_result", call_id: "call-search-1", package_id: "websearch", outcome: { text: "3 pages read", sites: [{ host: "example.com", url: "https://example.com/market" }, { host: "example.org", url: "https://example.org/library" }] } },
      ],
      value: { sources: SOURCES, rung: "search" },
    }),
  },
  {
    id: "failed-tool", title: "Failed tool", description: "The lookup failed and the reply says so in words: the failed tool chip, and for an admin the quiet error-details control beside the reply (its detail is read from a stored row this scenario writes).",
    storedOutcomes: [{ callId: "call-fail-1", packageId: "websearch", status: "failed", via: "tool_call", at: "2026-10-04T10:00:00.000Z", durationMs: 812, errorCode: "search_unavailable", userMessage: "The search engine timed out after 10 s (example.com/search answered 504)." }],
    events: turn("failed-tool", "I could not look that up just now, so this is from what I already know: the market usually opens in the morning, but please check before you go.", {
      lead: [
        { type: "status", stage: "lookup", text: "Looking that up" },
        { t: "tool_call", call_id: "call-fail-1", package_id: "websearch", args: { q: "saturday market hours" }, label: "Searching the web" },
        { t: "tool_error", call_id: "call-fail-1", package_id: "websearch", error: "The search engine timed out." },
      ],
      value: { rung: "failed" },
    }),
  },
  { id: "failure-engine-down", title: "Failure: engine down (chat)", description: "The chat engine is not running: the plain line an adult sees, code engine_unavailable.", events: failing("failure-engine-down", "", { type: "error", error: failureLine("unreachable", false), code: "engine_unavailable" }) },
  { id: "failure-engine-down-spoken", title: "Failure: engine down (spoken or child)", description: "The engine is down on a spoken or non-chat surface: the short grown-ups line, code engine_unavailable.", events: failing("failure-engine-down-spoken", "", { type: "error", error: failureLine("unreachable", true), code: "engine_unavailable" }) },
  { id: "failure-unavailable", title: "Failure: unavailable", description: "A generic unavailable failure after the turn started, code unavailable.", events: failing("failure-unavailable", "", { type: "error", error: failureLine("busy", false), code: "unavailable" }) },
  { id: "failure-generic", title: "Failure: mid-stream error", description: "The engine fails with no catalogue code (the plain generic error event).", events: failing("failure-generic", "", { type: "error", error: failureLine("other", false) }) },
  { id: "failure-cancelled", title: "Failure: cancelled", description: "The turn was cancelled on the server, code turn_cancelled.", events: failing("failure-cancelled", "", { type: "error", error: "cancelled", code: "turn_cancelled" }) },
  { id: "failure-safety", title: "Failure: safety refusal with crisis resources", description: "The output gate cut a reply for safety: the error carries the crisis resources (988) and code safety_refused.", events: failing("failure-safety", "I want to help with that, but", { type: "error", error: "I can't continue with that reply.", code: "safety_refused", crisis_resources: CRISIS }) },
  { id: "cutoff", title: "Mid-stream cutoff", description: "Half a reply streams, then the connection ends with the closing note.", events: failing("cutoff", "The recipe starts with two cups of flour, a pinch of salt and then you", { type: "error", error: partialReplyNote("slow", false), code: "unavailable" }) },
  { id: "crisis", title: "Crisis resources on a finished reply", description: "A finished, gentle reply that carries the crisis resources beside it (allow_with_resources).", events: turn("crisis", "I'm really glad you told me. You deserve support from someone who can be with you right now.", { value: { crisis_resources: CRISIS, safety: { ...SAFE, flagged: true, categories: ["self_harm"], action: "allow_with_resources" } } }) },
  { id: "incognito", title: "Incognito turn", description: "A reply whose turn is not stored (no conversation row). Turn the shell's Incognito toggle on to see the restyled UI around it.", events: turn("incognito", "This chat is not saved. Nothing from it is remembered once you close it.", { value: { conversation_id: "temporary" } }) },
  { id: "child", title: "Child-band short reply", description: "A short, simple reply with no reasoning block, as a child's turn is released.", events: turn("child", "Great question! Plants drink water through their roots, like a straw. 🌱") },
  {
    id: "spoken", title: "Spoken-surface turn", description: "A spoken cue first, then short sentences with the speech text carried on done (sentence-gated speech needs the voice engine).",
    events: turn("spoken", "Dinner is at six. Willow is setting the table.", { lead: [{ type: "spoken_cue", text: "One moment." }], value: { reply: { text: "Dinner is at six. Willow is setting the table.", speech: "Dinner is at six. Willow is setting the table." } } }),
  },
  { id: "links", title: "Image and links", description: "A markdown link, a bare URL and a picture served by the hub itself (a data: picture is blocked, so none is used).", events: turn("links", MD_LINKS) },
];

export function findFixture(id: string): UiFixture | undefined {
  return UI_FIXTURES.find((f) => f.id === id);
}
