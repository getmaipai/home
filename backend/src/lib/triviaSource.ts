import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { Host } from "@maipai/spec/emulators/ts/host-emulator.js";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PersonRow } from "@/types";
import type { AgeBand } from "@/lib/ageBand";
import { resolvePackageDir } from "@/lib/packageResolve";
import { recordServiceOutcome } from "@/lib/serviceHealth";

type BankQuestion = { id: string; band: AgeBand; category: string; question: string; answer: string; source: string };
type Bank = { version: 1; reviewed: { by: string; on: string | null }; questions: BankQuestion[] };
type OpenTdbQuestion = { question: string; answer: string };
type Rng = () => number;

let cachedBank: Bank | null = null;
const recentByPerson = new Map<string, string[]>();
const bands: AgeBand[] = ["child", "teen", "adult"];

function parseBank(value: unknown): Bank {
  if (!value || typeof value !== "object") throw new Error("trivia bank is not an object");
  const bank = value as Partial<Bank>;
  if (bank.version !== 1 || !bank.reviewed || typeof bank.reviewed.by !== "string" || !(bank.reviewed.on === null || typeof bank.reviewed.on === "string") || !Array.isArray(bank.questions)) throw new Error("trivia bank header is invalid");
  const ids = new Set<string>();
  for (const row of bank.questions) {
    if (!row || typeof row.id !== "string" || ids.has(row.id) || !bands.includes(row.band) || typeof row.category !== "string" || !row.question?.trim() || !row.answer?.trim() || !row.source?.trim()) throw new Error("trivia bank question is invalid");
    ids.add(row.id);
  }
  return bank as Bank;
}

function readBank(): Bank {
  if (cachedBank) return cachedBank;
  cachedBank = parseBank(JSON.parse(readFileSync(join(resolvePackageDir("trivia"), "bank.json"), "utf8")));
  return cachedBank;
}

function allowedBands(band: AgeBand): AgeBand[] { return bands.slice(0, bands.indexOf(band) + 1); }

function remember(personId: string, id: string): void {
  if (!personId) return;
  recentByPerson.set(personId, [...(recentByPerson.get(personId) ?? []).filter((value) => value !== id), id].slice(-10));
  if (recentByPerson.size > 64) recentByPerson.delete(recentByPerson.keys().next().value!);
}

function bankResult(actor: PersonRow, band: AgeBand, rng: Rng): PluginResult | null {
  try {
    const allowed = new Set(allowedBands(band));
    const questions = readBank().questions.filter((q) => allowed.has(q.band));
    if (!questions.length) return null;
    const personId = typeof actor.id === "string" ? actor.id : "";
    const recent = personId ? recentByPerson.get(personId) ?? [] : [];
    const fresh = questions.filter((q) => !recent.includes(q.id));
    const choices = fresh.length ? fresh : questions;
    const picked = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))]!;
    if (personId) {
      remember(personId, picked.id);
    }
    const text = `${picked.question} The answer: ${picked.answer}.`;
    return { reply: { text, speech: `${picked.question} ... The answer: ${picked.answer}.` }, actions: [], ...(band === "child" ? { synthesis_hint: "say this question and answer in simple, calm words" } : {}) };
  } catch {
    return null;
  }
}

/** The child path returns before the recipe callback is even invoked. */
export async function runTrivia(
  actor: PersonRow,
  band: AgeBand,
  manifest: PackageManifest,
  runOpenTdb: (capture: (question: OpenTdbQuestion) => void) => Promise<PluginResult>,
  rng: Rng = Math.random,
): Promise<PluginResult | null> {
  if (band === "child") return bankResult(actor, band, rng);
  try {
    const captured: { value: (OpenTdbQuestion & { id: string }) | null } = { value: null };
    const result = await runOpenTdb((question) => { captured.value = { ...question, id: question.question }; });
    if (!captured.value?.question?.trim() || !captured.value.answer?.trim() || !result.reply?.text || !result.reply.speech) return bankResult(actor, band, rng);
    if (band === "teen" && checkSafety(`${captured.value.question} ${captured.value.answer}`, { isMinor: true }).flagged) return bankResult(actor, band, rng);
    const attribution = manifest.data_sources?.find((row) => row.id === "opentdb")?.attribution;
    if (!attribution) return bankResult(actor, band, rng);
    remember(typeof actor.id === "string" ? actor.id : "", captured.value.id);
    return { ...result, reply: { text: `${result.reply.text} ${attribution}`, speech: `${result.reply.speech} ${attribution}` } };
  } catch {
    return bankResult(actor, band, rng);
  }
}

/** Wraps the one host.fetch used by the recipe to reject non-success API bodies. */
export function checkedOpenTdbHost(host: Host, capture: (question: OpenTdbQuestion & { id: string }) => void): Host {
  return { ...host, fetch: async (url, options) => {
    const body = await host.fetch(url, options);
    const parsed = body as { response_code?: unknown; results?: Array<{ question?: unknown; correct_answer?: unknown }> };
    if (parsed?.response_code === 5 || (body instanceof Response && body.status === 429)) {
      await recordServiceOutcome("opentdb.com", { ok: false, status: 429, error: new Error("Open Trivia Database rate limit") });
      throw new Error("Open Trivia Database rate limit");
    }
    const item = parsed?.results?.[0];
    if (parsed?.response_code !== 0 || typeof item?.question !== "string" || !item.question || typeof item.correct_answer !== "string" || !item.correct_answer) throw new Error("Open Trivia Database returned no question");
    capture({ question: item.question, answer: item.correct_answer, id: item.question });
    return body;
  } };
}

export function __resetTriviaForTests(): void { cachedBank = null; recentByPerson.clear(); }
