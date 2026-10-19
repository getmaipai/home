// CODE-API-01: the engine's event stream on its way to the tool. An adult's stream is forwarded frame by frame, byte for byte, while the safety floor
// reads the engine's parsed fields as they arrive (rule 10: checked as it arrives, released text is never retracted; a refused window stops the
// stream there). A child's or teen's stream is held whole: nothing is released until the whole answer, tool-call arguments included, has passed
// the floor, reasoning parts are dropped, and only then are the engine's own frames replayed. That is stricter than a sentence at a time and keeps
// the wires unmodified; the sentence-grain version, and the teen setting that may pick the adult's mode, belong to CODE-TEEN-01.
// While a held stream waits, a comment line goes out now and then so a tool does not give up on a quiet connection.
import { classifyFrame, createFrameParser, errorFrame, noteUsage, type CodeWire, type Frame, type Usage } from "@/lib/codeWire";
import { codingFloor, crisisText, outputRefusalLine } from "@/lib/codeSafety";
import type { AgeBand } from "@/lib/ageBand";

export type StreamOutcome = "ok" | "refused" | "upstream_error" | "cancelled";
export interface StreamGateOptions {
  wire: CodeWire;
  band: AgeBand;
  /** The person's own words already showed self-harm intent: the crisis resources are added to the answer. */
  crisis: boolean;
  keepAliveMs?: number;
  onFinish: (info: { usage: Usage; outcome: StreamOutcome }) => void;
}

const WINDOW_CHARS = 400;
const OVERLAP_CHARS = 160;

export function gateStream(upstream: ReadableStream<Uint8Array>, o: StreamGateOptions): ReadableStream<Uint8Array> {
  const strict = o.band !== "adult";
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.getReader();
  const parser = createFrameParser();
  const usage: Usage = { input: 0, output: 0 };
  const state = { reasoningBlocks: new Set<number>(), dropReasoning: strict };
  const buffered: string[] = [];
  let held: { raw: string; text: string; withText?: (t: string) => string } | null = null;
  let crisis = o.crisis;
  let crisisSent = false;
  let pending = "";
  let tail = "";
  let refused = false;
  let finished = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const send = (text: string) => { try { controller.enqueue(enc.encode(text)); } catch { /* the client is gone */ } };
  const out = (raw: string) => { if (strict) buffered.push(raw); else send(raw); };
  const finish = (outcome: StreamOutcome) => {
    if (finished) return;
    finished = true;
    if (ticker) clearInterval(ticker);
    o.onFinish({ usage, outcome });
  };
  const close = () => { try { controller.close(); } catch { /* already closed */ } };

  /** The window of the answer read since the last check, plus a short overlap so a phrase split across two deltas is still seen. */
  function check(add: string, final = false) {
    pending += add;
    if (!pending.trim()) { pending = ""; return; }
    if (!final && pending.length < WINDOW_CHARS && !/[.!?\n]\s*$/.test(pending)) return;
    const verdict = codingFloor(tail + pending, o.band, "out");
    if (verdict.crisis) crisis = true;
    if (verdict.action === "refuse") refused = true;
    tail = (tail + pending).slice(-OVERLAP_CHARS);
    pending = "";
  }

  /** Releases the text frame held back; when the answer showed self-harm intent, the crisis resources ride on it as extra text. */
  function releaseHeld(endOfRun: boolean) {
    if (!held) return;
    const { raw, text, withText } = held;
    held = null;
    const add = endOfRun && crisis && !crisisSent && withText;
    out(add ? withText(`${text}\n\n${crisisText()}`) : raw);
    if (add) crisisSent = true;
  }

  function handle(frame: Frame) {
    const c = classifyFrame(o.wire, frame, state);
    noteUsage(usage, c.json);
    const forward = strict && c.scrubbed ? c.scrubbed : frame.raw;
    if (c.channel === "reasoning") {
      if (strict) { if (!c.dropWhole && c.scrubbed) { releaseHeld(true); out(c.scrubbed); } return; }
      check(c.text);
      if (refused) return;
      releaseHeld(false); out(frame.raw);
      return;
    }
    if (c.channel === "text" || c.channel === "args") {
      check(c.text);
      if (refused) return;
      if (c.channel === "text") { releaseHeld(false); held = { raw: forward, text: c.text, withText: c.withText }; return; }
      releaseHeld(true); out(forward);
      return;
    }
    releaseHeld(true);
    out(forward);
  }

  async function run() {
    let outcome: StreamOutcome = "ok";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of parser.push(dec.decode(value, { stream: true }))) {
          handle(frame);
          if (refused) break;
        }
        if (refused) break;
      }
      if (!refused) for (const frame of parser.flush()) { handle(frame); if (refused) break; }
      if (!refused) check("", true);
      if (refused) {
        outcome = "refused";
        await reader.cancel().catch(() => {});
        held = null;
        send(errorFrame(o.wire, outputRefusalLine(o.band), "safety_refused"));
        return;
      }
      releaseHeld(true);
      if (strict) for (const raw of buffered) send(raw);
    } catch {
      outcome = "upstream_error";
      held = null;
      send(errorFrame(o.wire, "The coding engine stopped answering. Send the request again.", "upstream_error"));
    } finally {
      finish(outcome);
      close();
    }
  }

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (strict) {
        ticker = setInterval(() => send(": keep-alive\n\n"), o.keepAliveMs ?? 15_000);
        // The comment is the first byte, so the tool sees a live stream while the answer is held.
        send(": keep-alive\n\n");
      }
      void run();
    },
    cancel() {
      void reader.cancel().catch(() => {});
      finish("cancelled");
    },
  });
}
