// CODE-COMPOSER: the context ring: a small circle that fills as the context window fills, calm, then warning, then critical, with "x of y tokens used" as its tooltip.
import { i18n } from "@lingui/core";
import { ProgressRing } from "@maipai/ui/src/ui/progress-ring";
import type { CodeContext } from "./codeApi";
import { contextFraction, contextInk, tokenWords } from "./codeTranscript";

export function ContextRing({ context }: { context: CodeContext | undefined }) {
  if (!context) return null;
  const fraction = contextFraction(context.used_tokens, context.window_tokens);
  const words = context.window_tokens
    ? i18n._({ id: "{used} of {window} tokens used", message: "{used} of {window} tokens used", values: { used: tokenWords(context.used_tokens), window: tokenWords(context.window_tokens) } })
    : i18n._({ id: "{used} tokens used", message: "{used} tokens used", values: { used: tokenWords(context.used_tokens) } });
  return <span data-slot="code-context" title={words} className="inline-flex items-center gap-1 text-body text-muted-foreground">
    <ProgressRing value={fraction ?? 0} size={18} strokeWidth={3} label={words} animated={false} style={{ ["--primary" as string]: contextInk(fraction) }} />
    <span className="tabular-nums max-sm:sr-only">{fraction === null ? tokenWords(context.used_tokens) : `${Math.round(fraction * 100)}%`}</span>
  </span>;
}

