// Translated caption tracks: each language is its own CaptionTrack, made by the household's model from an existing track.
// Output is model text, so it passes the reader's age floor before it is stored (rule 10).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captionTracks } from "@/db/schema";
import { translateItems, TranslateHeldError, type Completer as CoreCompleter } from "@/lib/translate/core";
import { hubCompleter } from "@/lib/translate/engine";
import { LANGUAGES } from "@/lib/translate/languages";
import { mediaBandOf } from "@/lib/media/band";
import { evaluateReply } from "@/lib/safety";
import type { PersonRow } from "@/types";
import { listCaptionTracks, type CaptionTrackSummary } from "./captions";
import type { Cue } from "./cues";
import { addCaptionTrack, getTranscriptDatabaseRow, TranscriptError } from "./store";

export const TRANSLATION_LANGUAGES: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGES).map(([code, language]) => [code, language.english]),
);
export const MAX_TRANSLATED_CUES = 2000;

type TestCompleter = (messages: Parameters<CoreCompleter>[0]) => ReturnType<CoreCompleter>;
const defaultCompleter = hubCompleter();
let completer: TestCompleter = defaultCompleter;
export function __setTranslationCompleterForTests(fn: TestCompleter | null): void { completer = fn ?? defaultCompleter; }

const fail = (message: string, status = 502): never => { throw new TranscriptError(message, status); };

const HELD_MESSAGE = "Part of the translation was held back by the age filter, so no track was made. Try a different language or edit the original captions.";
const MODEL_FAILURE = "The language model could not translate these captions. Check that it is running, then try again.";

export type TranslationJob = { id: string; person: string; state: "running" | "done" | "failed"; progress: number; track?: CaptionTrackSummary; error?: string };
const jobs = new Map<string, TranslationJob>();
export function __resetTranslationJobsForTests(): void { jobs.clear(); }

/**
 * Checks the request, then translates in the background and returns at once. Progress is the share of captions done.
 * Nothing is stored unless every cue translated and passed the filter.
 */
export function startCaptionTranslation(actor: PersonRow, transcriptId: string, trackId: string, language: string): TranslationJob {
  const target = TRANSLATION_LANGUAGES[language];
  if (!target) return fail("That language is not in the list yet. Pick one of the listed languages.", 400);
  getTranscriptDatabaseRow(actor, transcriptId);
  const source = db.select().from(captionTracks).where(eq(captionTracks.id, trackId)).get();
  if (!source || source.transcriptId !== transcriptId) return fail("That caption track was not found. Reload the transcript and try again.", 404);
  if (source.language === language) return fail(`That track is already in ${target}. Pick a different language.`, 400);
  const band = mediaBandOf(actor);
  if (band === "child") return fail("Transcripts are available to teens and adults.", 403);
  const cues = JSON.parse(source.cues) as Cue[];
  if (cues.length === 0) return fail("That caption track has no captions to translate.", 400);
  if (cues.length > MAX_TRANSLATED_CUES) return fail(`This track has ${cues.length} captions and translation handles up to ${MAX_TRANSLATED_CUES} at a time. Translate a shorter transcript.`, 413);
  const from = TRANSLATION_LANGUAGES[source.language] ?? "the original language";

  const job: TranslationJob = { id: randomUUID(), person: actor.id, state: "running", progress: 0 };
  jobs.set(job.id, job);
  void (async () => {
    try {
      const result = await translateItems({
        items: cues.map((cue) => cue.text),
        from: source.language,
        to: language,
        kind: "subtitle",
        completer,
        check: (outs) => evaluateReply({ text: outs.join("\n") }, band).effective.action !== "allow" ? HELD_MESSAGE : null,
        onProgress: (done, total) => { job.progress = total === 0 ? 1 : done / total; },
      });
      if (result.failed.length > 0) fail(MODEL_FAILURE);
      const translated = cues.map((cue, index) => ({
        ...cue,
        id: `${cue.id}-${language}`,
        text: result.results[index]!,
        text_overridden: false,
      }));
      const row = addCaptionTrack(actor, transcriptId, {
        language,
        basedOnRevision: source.basedOnRevision,
        cues: translated,
        provenance: { source_kind: "translated", engine: "home-llm" },
      });
      console.info(JSON.stringify({ event: "transcript.captions_translated", cues: translated.length }));
      job.track = listCaptionTracks(actor, transcriptId).find((track) => track.id === row.id);
      job.progress = 1;
      job.state = "done";
    } catch (error) {
      job.state = "failed";
      if (error instanceof TranslateHeldError) {
        job.error = new TranscriptError(error.message, 422).message;
      } else {
        job.error = error instanceof TranscriptError ? error.message : "The captions could not be translated. Check that the language model is running, then try again.";
      }
    }
  })();
  return { ...job };
}

export function translationJob(actor: PersonRow, id: string): TranslationJob {
  const job = jobs.get(id);
  if (!job || job.person !== actor.id) return fail("That translation was not found. Start it again.", 404);
  return { ...job };
}
