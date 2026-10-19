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
  /** How long the engine may stay silent before the stream is ended with a plain error. */
  idleMs?: number;
  onFinish: (info: { usage: Usage; outcome: StreamOutcome; outputChars: number }) => void;
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
  let outputChars = 0;
  const held_text: string[] = []; // a held (minor's) answer, read as one text at the end
  let finished = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const send = (text: string) => { try { controller.enqueue(enc.encode(text)); } catch { /* the client is gone */ } };
  const out = (raw: string) => { if (strict) buffered.push(raw); else send(raw); };
  const finish = (outcome: StreamOutcome) => {
    if (finished) return;
    finished = true;
    if (ticker) clearInterval(ticker);
    o.onFinish({ usage, outcome, outputChars });
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

  /** Words in the answer: an adult's are checked window by window as they arrive, a minor's are gathered and checked once, whole, before anything is released. */
  let lastText: { index: number; text: string; withText?: (t: string) => string } | null = null;
  let lastChannel = "";
  function observe(text: string, channel: string) {
    if (!text) return;
    outputChars += text.length;
    // Deltas of one kind run together as the engine wrote them; a change of kind starts a new line.
    if (strict) { held_text.push(channel === lastChannel ? text : `\n${text}`); lastChannel = channel; } else check(text);
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
    const words = c.checkText ?? c.text;
    if (c.channel === "reasoning") {
      if (strict) { if (!c.dropWhole && c.scrubbed) { releaseHeld(true); out(c.scrubbed); } return; }
      check(words);
      if (refused) return;
      releaseHeld(false); out(frame.raw);
      return;
    }
    observe(words, c.channel);
    if (refused) return;
    // A frame that is not words ends a run of words (a block closing, the finish): whatever an adult's window still holds is read now, before the held frame goes out.
    if (c.channel === "other" && !strict) { check("", true); if (refused) return; }
    if (c.channel === "text" && strict) { buffered.push(forward); lastText = { index: buffered.length - 1, text: c.text, withText: c.withText }; return; }
    if (c.channel === "text") { releaseHeld(false); held = { raw: forward, text: c.text, withText: c.withText }; return; }
    releaseHeld(true);
    out(forward);
  }

  /** Reads the next chunk, or gives up when the engine has been silent for too long. */
  function readNext(): ReturnType<typeof reader.read> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("idle")), o.idleMs ?? 300_000);
      reader.read().then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
  }

  async function run() {
    let outcome: StreamOutcome = "ok";
    try {
      for (;;) {
        const { value, done } = await readNext();
        if (done) break;
        for (const frame of parser.push(dec.decode(value, { stream: true }))) {
          handle(frame);
          if (refused) break;
        }
        if (refused) break;
      }
      if (!refused) for (const frame of parser.flush()) { handle(frame); if (refused) break; }
      if (!refused) {
        if (strict) {
          // The answer is held whole, so it is read whole, once, as the non-streamed path reads it; the crisis offer follows what the whole answer says.
          const verdict = codingFloor(held_text.join(""), o.band, "out");
          if (verdict.crisis) crisis = true;
          if (verdict.action === "refuse") refused = true;
        } else check("", true);
      }
      if (refused) {
        outcome = "refused";
        void reader.cancel().catch(() => {});
        held = null;
        send(errorFrame(o.wire, outputRefusalLine(o.band), "safety_refused"));
        return;
      }
      releaseHeld(true);
      if (strict) {
        // The resources ride on the last text frame; the whole answer has been read by now, so what it showed is known.
        if (crisis && lastText?.withText) buffered[lastText.index] = lastText.withText(`${lastText.text}\n\n${crisisText()}`);
        for (const raw of buffered) send(raw);
      }
    } catch {
      outcome = "upstream_error";
      held = null;
      void reader.cancel().catch(() => {});
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
