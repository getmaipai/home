// Chat-template control tokens (harmony style `<|message|>`, `<|channel|>final`, `<|start|>assistant`,
// `<|end|>`, `<|return|>`, and the ChatML / Llama kind such as `<|im_end|>`) are the engine's own framing, never
// words for a person. A model sometimes writes one into its visible reply (seen live: `red<|message|>` in a
// spoken-turn reply). This is the one place they are removed: the Stack client boundary in llm.ts runs every
// piece of visible content and every blocking completion through here, so what is shown, spoken and stored is
// clean. Reasoning text is cleaned the same way.

const CHANNEL_NAMES = "(?:analysis|commentary|final)";
const ROLE_NAMES = "(?:assistant|user|system|developer|tool)";
/** `<|channel|>final`, `<|start|>assistant`, or any other `<|name|>` token. */
const TOKEN = new RegExp(`<\\|(?:channel\\|>\\s*${CHANNEL_NAMES}?|start\\|>\\s*${ROLE_NAMES}?|[a-z0-9_]{1,24}\\|>)`, "gi");
/** The end of a buffer that may still become a token once the next piece arrives. */
const PARTIAL_TAIL = /<(?:\|(?:[a-z0-9_]{0,24}\|?|channel\|>\s*[a-z]{0,10}|start\|>\s*[a-z]{0,10}))?$/i;
const MAX_HELD = 48;

/** The text without chat-template control tokens. Text that is not a token is returned unchanged. */
export function stripChatTemplateTokens(text: string): string {
  if (!text.includes("<|")) return text;
  return text.replace(TOKEN, "");
}

/** Streaming form: pieces arrive split anywhere, so a possible token start at the end of the buffer is held until the next piece settles it. */
export class ChatTemplateTokenFilter {
  private held = "";

  push(piece: string): string {
    const buffer = this.held + piece;
    const tail = PARTIAL_TAIL.exec(buffer);
    const cut = tail && buffer.length - tail.index <= MAX_HELD ? tail.index : buffer.length;
    this.held = buffer.slice(cut);
    return stripChatTemplateTokens(buffer.slice(0, cut));
  }

  /** The stream ended: whatever was held cannot become a token any more. */
  flush(): string {
    const rest = this.held;
    this.held = "";
    return stripChatTemplateTokens(rest);
  }
}
