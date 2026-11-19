import { config } from "./config";
export type State = "idle" | "user_speaking" | "maybe_done" | "thinking" | "speaking";
export type Command = { type: string; [key: string]: unknown };
type Options = typeof config & { talkOverMode: "pause_then_decide" | "stop_fast"; backchannelGapMs: number; backchannelMaxMs: number };
export class TurnManager {
  state: State = "idle";
  private speechAt = -1; private silenceAt = -1; private cutAt = -1; private last = 0;
  private checked = false; private transcript = ""; private probability = 0; private echo = false;
  private cutSpeech = 0; private cutLast = 0; private cutPrev = 0; private ducked = false;
  private paused = false; private cutEnded = false; private clock: () => number;
  private opts: Options = { ...config, talkOverMode: "pause_then_decide", backchannelGapMs: 250, backchannelMaxMs: 1400 };
  constructor(clock: () => number = () => performance.now()) { this.clock = clock; }
  private emit(type: string, extra: Record<string, unknown> = {}): Command[] { return [{ type, ...extra }]; }
  get cutDuration() { return this.cutSpeech; }
  frame(speech: boolean, now = this.clock()): Command[] {
    const out: Command[] = []; this.last = now;
    if (["idle", "user_speaking", "maybe_done"].includes(this.state)) {
      if (speech) {
        if (this.state === "idle") { if (this.speechAt < 0) this.speechAt = now; if (now - this.speechAt >= this.opts.speechStartMs) { this.state = "user_speaking"; this.silenceAt = -1; return this.emit("state", { state: this.state }); } return []; }
        if (this.state === "maybe_done") { this.state = "user_speaking"; this.checked = false; this.transcript = ""; this.probability = 0; this.silenceAt = -1; return this.emit("cancel_held"); }
        this.silenceAt = -1; return [];
      }
      if (this.state === "idle") { this.speechAt = -1; return []; }
      if (this.silenceAt < 0) this.silenceAt = now;
      const silence = now - this.silenceAt;
      if (this.state === "user_speaking" && silence >= this.opts.checkSilenceMs) { this.state = "maybe_done"; out.push(...this.emit("check_turn")); }
      if (this.state === "maybe_done" && silence >= this.opts.commitSilenceMs) { if (this.transcript) { this.state = "thinking"; out.push(...this.emit("commit", { reason: "timeout", transcript: this.transcript })); } else { this.state = "idle"; out.push(...this.emit("discard")); } }
      return out;
    }
    if (this.state !== "thinking" && this.state !== "speaking") return out;
    if (speech) {
      if (this.cutAt < 0) { this.cutAt = now; this.cutSpeech = 0; this.ducked = false; this.paused = false; this.cutEnded = false; this.cutPrev = now - this.opts.frameMs; }
      this.cutSpeech += Math.min(this.opts.frameMs * 1.5, Math.max(0, now - this.cutPrev)); this.cutPrev = now; this.cutLast = now;
      if (!this.ducked && this.cutSpeech >= this.opts.duckMs) { this.ducked = true; out.push(...this.emit("duck")); }
      if (this.opts.talkOverMode === "pause_then_decide" && !this.paused && this.cutSpeech >= this.opts.interruptMs && !this.echo) { this.paused = true; out.push(...this.emit("pause")); }
      if (this.opts.talkOverMode === "stop_fast" && this.cutSpeech >= this.opts.interruptMs && !this.echo) return [...out, ...this.interrupt()];
      if (this.paused && this.cutSpeech >= this.opts.backchannelMaxMs && !this.echo) return [...out, ...this.emit("transcribe_cut_in", { duration: this.cutSpeech, forced: true }), ...this.interrupt()];
      return out;
    }
    if (this.cutAt >= 0) {
      this.cutPrev = now;
      if (this.paused && !this.cutEnded && now - this.cutLast >= this.opts.backchannelGapMs) { this.cutEnded = true; out.push(...this.emit("transcribe_cut_in", { duration: this.cutSpeech })); }
      else if (!this.paused && now - this.cutLast >= this.opts.cutGapMs) { if (this.ducked) out.push(...this.emit("resume")); this.resetCut(); }
    }
    return out;
  }
  private resetCut() { this.cutAt = -1; this.ducked = false; this.paused = false; this.cutEnded = false; this.echo = false; }
  private interrupt(): Command[] { this.state = "user_speaking"; this.speechAt = this.cutAt; this.silenceAt = -1; const duration = this.cutSpeech; this.resetCut(); return this.emit("interrupt", { duration }); }
  cutTranscript(text: string, backchannel: boolean): Command[] {
    if (!this.paused) return [];
    if (backchannel && this.cutSpeech < this.opts.backchannelMaxMs) { this.resetCut(); return this.emit("backchannel", { backchannel: true }); }
    return this.interrupt();
  }
  transcriptReady(text: string, now = this.clock()): Command[] { this.transcript = text.trim(); if (this.state !== "maybe_done" || !this.transcript) return []; const out = this.opts.earlyStart ? this.emit("start_reply_held", { transcript: this.transcript, at: now }) : []; if (this.probability >= this.opts.turnThreshold) { this.state = "thinking"; out.push(...this.emit("commit", { reason: "model", transcript: this.transcript })); } return out; }
  turnModel(probability: number, complete: boolean): Command[] { this.probability = complete ? probability : 0; if (this.state === "maybe_done" && complete && probability >= this.opts.turnThreshold && this.transcript) { this.state = "thinking"; return this.emit("commit", { reason: "model", transcript: this.transcript }); } return []; }
  setEcho(echo: boolean) { this.echo = echo; }
  firstAudioPlayed(): Command[] { if (this.state === "thinking") { this.state = "speaking"; return this.emit("state", { state: this.state }); } return []; }
  playbackEnded(): Command[] { if (this.state === "speaking" || this.state === "thinking") { this.state = "idle"; return this.emit("state", { state: this.state }); } return []; }
  get cutting() { return this.cutAt >= 0; }
  stop(): Command[] { this.state = "idle"; this.resetCut(); return this.emit("interrupt", { tap: true }); }
  configure(values: Partial<Options>) { this.opts = { ...this.opts, ...values }; }
}
