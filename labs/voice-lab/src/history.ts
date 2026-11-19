export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  interrupted?: boolean;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export class History {
  readonly messages: Message[];
  private exchanges = 0;

  constructor(system: string) {
    this.messages = [{ role: "system", content: system }];
  }

  commitUser(text: string) {
    this.messages.push({ role: "user", content: text });
  }

  private trim() {
    if (this.exchanges <= 40) return;
    let users = 0;
    let cut = this.messages.length;
    for (let index = 1; index < this.messages.length; index++) {
      if (this.messages[index]?.role === "user" && ++users === 21) { cut = index; break; }
    }
    this.messages.splice(1, cut - 1);
    this.exchanges -= 20;
  }

  commitAssistant(text: string) {
    this.messages.push({ role: "assistant", content: text });
    this.exchanges++;
    this.trim();
  }

  commitToolExchange(assistantWords: string, calls: unknown[], results: Array<{ id: string; content: string }>) {
    this.messages.push({ role: "assistant", content: assistantWords, tool_calls: calls });
    for (const result of results) this.messages.push({ role: "tool", tool_call_id: result.id, content: result.content });
  }

  trimAssistantToHeard(chunks: string[], playedMsByChunk: number[], durations: number[]) {
    let heard = "";
    for (let i = 0; i < chunks.length; i++) {
      const ratio = Math.max(0, Math.min(1, (playedMsByChunk[i] ?? 0) / (durations[i] || 1)));
      if (ratio >= 1) heard += (heard ? " " : "") + chunks[i];
      else if (ratio > 0) {
        const approx = Math.floor(chunks[i]!.length * ratio);
        const cut = chunks[i]!.lastIndexOf(" ", approx);
        heard += (heard ? " " : "") + chunks[i]!.slice(0, Math.max(0, cut));
        break;
      } else break;
    }
    heard = heard.trimEnd();
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") last.content = `${heard} [cut off here by the person]`;
    return heard;
  }
}
