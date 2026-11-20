import { config } from "./config";
import { commitDelay } from "./commitDelay";

export type State = "idle" | "user_speaking" | "maybe_done" | "thinking" | "speaking";
export type Command = { type: string; [key: string]: unknown };
type Options = typeof config & { talkOverMode: "continue" | "pause_then_decide" | "stop_fast"; backchannelGapMs: number; backchannelMaxMs: number };

export class TurnManager {
  state: State = "idle";
  private speechAt = -1;
  private silenceAt = -1;
  private cutAt = -1;
  private checked = false;
  private transcript = "";
  private probability = -1;
  private echo = false;
  private cutSpeech = 0;
  private cutLast = 0;
  private cutPrev = 0;
  private ducked = false;
  private paused = false;
  private cutEnded = false;
  private cutUnknown = false;
  private revision = 0;
  private clock: () => number;
  private opts: Options = { ...config, talkOverMode: "continue", backchannelGapMs: 200, backchannelMaxMs: 800 };

  constructor(clock: () => number = () => performance.now()) { this.clock = clock; }
  private emit(type: string, extra: Record<string, unknown> = {}): Command[] { return [{ type, ...extra }]; }
  /** The device says a person is clearly talking over her: stop now, keep what was heard so far as the start of their turn. */
  forceInterrupt(): Command[] { if (this.cutAt < 0) return []; const duration = this.cutSpeech; return [...this.emit("transcribe_cut_in", { duration, forced: true }), ...this.interrupt()]; }
  silenceMs(now = this.clock()) { return this.silenceAt < 0 ? 0 : now - this.silenceAt; }
  get turnProbability() { return this.probability; }
  get echoLikely() { return this.echo; }
  get cutDuration() { return this.cutSpeech; }
  get checkRevision() { return this.revision; }

  private resetTurn() {
    this.revision++;
    this.speechAt = -1;
    this.silenceAt = -1;
    this.checked = false;
    this.transcript = "";
    this.probability = -1;
  }

  frame(speech: boolean, now = this.clock()): Command[] {
    if (["idle", "user_speaking", "maybe_done"].includes(this.state)) {
      if (speech) {
        if (this.state === "idle") {
          if (this.speechAt < 0) this.speechAt = now;
          if (now - this.speechAt >= this.opts.speechStartMs) {
            this.state = "user_speaking";
            this.revision++;
            return this.emit("state", { state: this.state });
          }
          return [];
        }
        if (this.state === "maybe_done") {
          this.resetTurn();
          this.state = "user_speaking";
          return this.emit("cancel_held", { revision: this.revision });
        }
        this.silenceAt = -1;
        return [];
      }
      if (this.state === "idle") { this.speechAt = -1; return []; }
      if (this.silenceAt < 0) this.silenceAt = now;
      const silence = now - this.silenceAt;
      if (this.state === "user_speaking" && silence >= this.opts.checkSilenceMs) {
        this.state = "maybe_done";
        this.revision++;
        return this.emit("check_turn", { revision: this.revision });
      }
      if (this.state === "maybe_done" && silence >= commitDelay(this.transcript, this.probability < 0 ? 1 : this.probability, this.opts.commitSilenceMs) && this.transcript) {
        this.state = "thinking";
        this.revision++;
        return this.emit("commit", { reason: "timeout", transcript: this.transcript, revision: this.revision });
      }
      return [];
    }

    if (this.state !== "thinking" && this.state !== "speaking") return [];
    const out: Command[] = [];
    if (speech) {
      if (this.cutAt < 0) { this.cutAt = now; this.cutSpeech = 0; this.ducked = false; this.paused = false; this.cutEnded = false; this.cutPrev = now - this.opts.frameMs; }
      else if (this.opts.talkOverMode === "continue" && this.cutEnded) { this.cutEnded = false; this.cutSpeech = 0; }
      this.cutSpeech += Math.min(this.opts.frameMs * 1.5, Math.max(0, now - this.cutPrev));
      this.cutPrev = now;
      this.cutLast = now;
      if (!this.ducked && this.cutSpeech >= this.opts.duckMs) { this.ducked = true; out.push(...this.emit("duck")); }
      if (this.opts.talkOverMode === "pause_then_decide" && !this.paused && this.cutSpeech >= this.opts.interruptMs && !this.echo) { this.paused = true; out.push(...this.emit("pause")); }
      if (this.opts.talkOverMode === "stop_fast" && this.cutSpeech >= this.opts.interruptMs && !this.echo) return [...out, ...this.interrupt()];
      if (this.cutSpeech > 0 && Math.floor(this.cutSpeech / 350) !== Math.floor((this.cutSpeech - this.opts.frameMs) / 350)) out.push(...this.emit("transcribe_cut_in", { duration: this.cutSpeech }));
      return out;
    }
    if (this.cutAt >= 0) {
      this.cutPrev = now;
      // nothing was recognised and the sound has stopped: it was noise or her own voice, never an interruption
      if (this.cutUnknown && now - this.cutLast >= 600) { const r = this.ducked ? this.emit("resume") : []; this.resetCut(); return r; }
      if (!this.cutEnded && now - this.cutLast >= this.opts.backchannelGapMs) {
        this.cutEnded = true;
        out.push(...this.emit("transcribe_cut_in", { duration: this.cutSpeech }));
      }
      else if (!this.paused && this.opts.talkOverMode !== "continue" && now - this.cutLast >= this.opts.cutGapMs) { if (this.ducked) out.push(...this.emit("resume")); this.resetCut(); }
    }
    return out;
  }

  private resetCut() { this.cutAt = -1; this.cutSpeech = 0; this.ducked = false; this.paused = false; this.cutEnded = false; this.cutUnknown = false; this.echo = false; }
  private interrupt(): Command[] {
    const start = this.cutAt;
    const duration = this.cutSpeech;
    this.state = "user_speaking";
    this.resetTurn();
    this.state = "user_speaking";
    this.speechAt = start;
    this.resetCut();
    return this.emit("interrupt", { duration, revision: this.revision });
  }

  /** The words heard during a cut-in decide it: "ack" (mm-hm) and "echo" (her own voice) resume the reply, "interrupt" stops it, "unknown"
   * (nothing recognised: noise, or her own voice too blurred to read) never stops it. A lone duck or a long run of voice-like sound is not enough. */
  cutTranscript(text: string, decision: "ack" | "interrupt" | "unknown" | "echo" | boolean): Command[] {
    if (this.cutAt < 0) return [];
    const verdict = typeof decision === "boolean" ? (decision ? "ack" : "interrupt") : decision;
    if (verdict === "ack" || verdict === "echo") { this.resetCut(); return this.emit("backchannel", { backchannel: true, verdict }); }
    if (verdict === "unknown") { this.cutUnknown = true; return []; }
    return this.interrupt();
  }

  transcriptReady(text: string, now = this.clock(), revision = this.revision): Command[] {
    if (revision !== this.revision || this.state !== "maybe_done") return [];
    this.transcript = text.trim();
    if (!this.transcript) return [];
    const out = this.opts.earlyStart ? this.emit("start_reply_held", { transcript: this.transcript, at: now, revision }) : [];
    if (this.probability >= this.opts.turnThreshold) {
      this.state = "thinking";
      this.revision++;
      out.push(...this.emit("commit", { reason: "model", transcript: this.transcript, revision: this.revision }));
    }
    return out;
  }

  turnModel(probability: number, complete: boolean, revision = this.revision): Command[] {
    if (revision !== this.revision || this.state !== "maybe_done") return [];
    this.probability = complete ? probability : -1;
    if (complete && probability >= this.opts.turnThreshold && this.transcript) {
      this.state = "thinking";
      this.revision++;
      return this.emit("commit", { reason: "model", transcript: this.transcript, revision: this.revision });
    }
    return [];
  }

  setEcho(echo: boolean) { this.echo = echo; }
  resumeCommittedSpeech(): Command[] {
    if (this.state !== "thinking" && this.state !== "speaking") return [];
    this.state = "user_speaking";
    this.resetTurn();
    this.state = "user_speaking";
    this.speechAt = this.clock();
    this.resetCut();
    return this.emit("resume_committed");
  }
  firstAudioPlayed(): Command[] { if (this.state === "thinking") { this.state = "speaking"; return this.emit("state", { state: this.state }); } return []; }
  playbackEnded(): Command[] {
    if (this.state === "speaking" || this.state === "thinking") {
      this.state = "idle";
      this.resetTurn();
      this.resetCut();
      return this.emit("state", { state: this.state });
    }
    return [];
  }
  get cutting() { return this.cutAt >= 0; }
  /** The transcript was her own voice coming back: forget this turn without stopping or answering anything. */
  dropTurn(): Command[] { this.state = "idle"; this.resetTurn(); this.resetCut(); return this.emit("discard", {}); }
  stop(): Command[] { this.state = "idle"; this.resetTurn(); this.resetCut(); return this.emit("interrupt", { tap: true }); }
  configure(values: Partial<Options>) { this.opts = { ...this.opts, ...values }; }
}
