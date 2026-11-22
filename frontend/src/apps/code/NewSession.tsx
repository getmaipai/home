// CODE-APP-01 and CODE-TIER-04: the New session row. A box for the first message and the tier control, listing only the tiers this person may run;
// a new session starts on the tier they used last (the hub says which).
import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TierSegment, type TierId, type TierOptionDef } from "@maipai/ui/src/elements/tier-segment";
import { Button } from "@maipai/ui/src/ui/button";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { errorLine } from "@/lib/hubReachability";
import { Stack } from "./layout";
import { codeApi, type CodeTier } from "./codeApi";
import { tierWord } from "./codeTranscript";

export const CODE_TIERS_KEY = ["code-tiers"];
export const CODE_SESSIONS_KEY = ["code-sessions"];

/** The kit's tier options for the tiers the hub offers (a tier left out is not drawn). */
export const tierOptions = (tiers: readonly CodeTier[]): TierOptionDef[] => tiers.map((id) => ({ id, label: tierWord(id) }));

export function NewSession() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tiers = useQuery({ queryKey: CODE_TIERS_KEY, queryFn: codeApi.tiers, retry: false });
  const [text, setText] = useState("");
  const [tier, setTier] = useState<CodeTier | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const offered = tiers.data?.tiers ?? [];
  const value: CodeTier = tier && offered.includes(tier) ? tier : tiers.data?.last ?? "standard";
  useEffect(() => { setProblem(""); }, [text]);

  async function start() {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      const session = await codeApi.create(message.split("\n")[0]!.slice(0, 100), value);
      await codeApi.send(session.id, message);
      setText("");
      await queryClient.invalidateQueries({ queryKey: CODE_SESSIONS_KEY });
      navigate(`/apps/code/${session.id}`);
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not start the session. Try again.", message: "Could not start the session. Try again." })));
    } finally { setBusy(false); }
  }

  return (
    <Stack as="form" data-slot="code-new-session" className="mx-auto w-full max-w-2xl p-4" onSubmit={(event) => { event.preventDefault(); void start(); }}>
      <h2 className="text-title">{i18n._({ id: "What should we work on?", message: "What should we work on?" })}</h2>
      <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} aria-label={i18n._({ id: "Describe the task", message: "Describe the task" })} placeholder={i18n._({ id: "Describe the task, for example: fix the failing test in the thermostat code.", message: "Describe the task, for example: fix the failing test in the thermostat code." })} />
      <Stack row className="flex-wrap items-center justify-between">
        {offered.length > 1 ? <div data-slot="code-tier"><TierSegment value={value as TierId} onValueChange={(next) => setTier(next)} tiers={tierOptions(offered)} presentation="segment" label={i18n._({ id: "Level", message: "Level" })} /></div> : <span />}
        <Button type="submit" disabled={busy || !text.trim()}>{i18n._({ id: "Start session", message: "Start session" })}</Button>
      </Stack>
      {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
    </Stack>
  );
}
