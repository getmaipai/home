// CODE-POLISH: the session's composer. A message box with a + button and drag and drop for adding files (they go to the session's workspace), an @ picker
// for files already there, attached files as chips, and one status bar under it: the level control (only the tiers this person may run), the permission mode,
// the context ring and the state. The context ring colours move from calm to warning to critical as the window fills.
import { i18n } from "@lingui/core";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { TierChip, TierSegment, type TierId } from "@maipai/ui/src/elements/tier-segment";
import { ProgressRing } from "@maipai/ui/src/ui/progress-ring";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Button } from "@maipai/ui/src/ui/button";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Input } from "@maipai/ui/src/ui/input";
import { getIcon } from "@maipai/ui/src/icons";
import { errorLine } from "@/lib/hubReachability";
import { codeApi, type CodeContext, type CodeSession, type CodeTier } from "./codeApi";
import { contextFraction, contextInk, tokenWords } from "./codeTranscript";
import { tierOptions } from "./NewSession";
import { Stack } from "./layout";

const PlusIcon = getIcon("plus");

const modeWords = (mode: CodeSession["mode"]): string => mode === "plan" ? i18n._({ id: "Plan first", message: "Plan first" }) : mode === "auto_edit" ? i18n._({ id: "Edits without asking", message: "Edits without asking" }) : i18n._({ id: "Asks before changes", message: "Asks before changes" });

export function ContextRing({ context }: { context: CodeContext | undefined }) {
  if (!context) return null;
  const fraction = contextFraction(context.used_tokens, context.window_tokens);
  const words = context.window_tokens
    ? i18n._({ id: "{used} of {window} tokens used", message: "{used} of {window} tokens used", values: { used: tokenWords(context.used_tokens), window: tokenWords(context.window_tokens) } })
    : i18n._({ id: "{used} tokens used", message: "{used} tokens used", values: { used: tokenWords(context.used_tokens) } });
  return <span data-slot="code-context" title={words} className="inline-flex items-center gap-1 text-body text-muted-foreground">
    <ProgressRing value={fraction ?? 0} size={18} strokeWidth={3} label={words} animated={false} style={{ ["--primary" as string]: contextInk(fraction) }} />
    <span className="tabular-nums">{fraction === null ? tokenWords(context.used_tokens) : `${Math.round(fraction * 100)}%`}</span>
  </span>;
}

export interface Attachment { path: string; name: string }

export function Composer({ session, tiers, onTier, maxNext, context, statusLine, disabled, onSend, onProblem }: {
  session: CodeSession; tiers: readonly CodeTier[]; onTier: (tier: TierId) => void; maxNext: boolean; context: CodeContext | undefined; statusLine: string; disabled: boolean;
  onSend: (text: string) => Promise<void>; onProblem: (line: string) => void;
}) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const tier: CodeTier = session.tier ?? "standard";
  const mention = /(?:^|\s)@([\w./-]*)$/.exec(text);
  const tree = useQuery({ queryKey: ["code-tree", session.id, session.last_activity_at], queryFn: () => codeApi.tree(session.id), retry: false, enabled: mention !== null });
  const matches = useMemo(() => mention ? (tree.data?.entries ?? []).filter((e) => e.kind === "file" && e.path.toLowerCase().includes(mention[1]!.toLowerCase())).slice(0, 6) : [], [mention, tree.data]);

  async function add(files: FileList | File[]) {
    setUploading(true);
    for (const file of Array.from(files)) {
      try { const done = await codeApi.upload(session.id, file); setAttached((now) => [...now, { path: done.path, name: file.name }]); }
      catch (error) { onProblem(errorLine(error, i18n._({ id: "Could not add {name}. Try again.", message: "Could not add {name}. Try again.", values: { name: file.name } }))); }
    }
    setUploading(false);
  }
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length > 0) void add(event.dataTransfer.files); };
  async function submit() {
    const body = text.trim();
    if (!body) return;
    const files = attached.map((a) => a.path);
    setText(""); setAttached([]);
    await onSend(files.length ? `${body}\n\n${i18n._({ id: "Files I added:", message: "Files I added:" })} ${files.join(", ")}` : body);
  }

  return <Stack gap="tight" data-slot="code-composer" data-dragging={dragging ? "" : undefined} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    {attached.length > 0 ? <Stack row gap="tight" className="flex-wrap" data-slot="code-attachments">{attached.map((a) => <Chip key={a.path} onRemove={() => setAttached((now) => now.filter((x) => x.path !== a.path))} removeLabel={i18n._({ id: "Remove {name}", message: "Remove {name}", values: { name: a.name } })}>{a.name}</Chip>)}</Stack> : null}
    {matches.length > 0 ? <Stack gap="none" role="listbox" data-slot="code-mentions" aria-label={i18n._({ id: "Files in the workspace", message: "Files in the workspace" })} className="rounded-md border border-border bg-popover p-1">
      {matches.map((m) => <Button key={m.path} type="button" variant="ghost" size="sm" role="option" aria-selected="false" onClick={() => setText((t) => t.replace(/@[\w./-]*$/, `@${m.path} `))}><span className="truncate font-mono">{m.path}</span></Button>)}
    </Stack> : null}
    <Stack as="form" gap="tight" className="rounded-xl border border-border bg-card p-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Textarea value={text} rows={2} onChange={(event) => setText(event.target.value)} aria-label={i18n._({ id: "Message to the agent", message: "Message to the agent" })} placeholder={dragging ? i18n._({ id: "Drop files to add them", message: "Drop files to add them" }) : i18n._({ id: "Message the agent. Type @ to point at a file.", message: "Message the agent. Type @ to point at a file." })}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <Stack row className="items-center justify-between">
        <Input ref={picker} type="file" multiple hidden data-slot="code-file-input" onChange={(event) => { if (event.target.files) void add(event.target.files); event.target.value = ""; }} />
        <Button type="button" size="icon-sm" variant="ghost" disabled={uploading} aria-label={i18n._({ id: "Add files", message: "Add files" })} onClick={() => picker.current?.click()}><PlusIcon aria-hidden /></Button>
        <Button type="submit" size="sm" disabled={!text.trim() || disabled}>{i18n._({ id: "Send", message: "Send" })}</Button>
      </Stack>
    </Stack>
    <Stack row className="flex-wrap items-center justify-between px-1" data-slot="code-statusbar">
      <Stack row className="flex-wrap items-center">
        {tiers.length > 1 ? <div data-slot="code-status-tier"><TierSegment value={tier} onValueChange={onTier} tiers={tierOptions(tiers)} density="compact" label={i18n._({ id: "Level", message: "Level" })} /></div> : <TierChip tier={tier} />}
        {maxNext ? <TierChip tier="max" label={i18n._({ id: "Max from the next message", message: "Max from the next message" })} /> : null}
        <span className="text-body text-muted-foreground">{modeWords(session.mode)}</span>
      </Stack>
      <Stack row className="items-center"><ContextRing context={context} /><span role="status" data-slot="code-status" className="text-body text-muted-foreground">{statusLine}</span></Stack>
    </Stack>
  </Stack>;
}
