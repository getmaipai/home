// STACK-MODELS-HOME-01: the plain notice for any old model value the Stack did not take when Home moved its choices over once (a model it no longer
// offers, a record Home could not describe). The value stays in Home; the admin chooses again on the page. Dismissed once read.
import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { requestJson } from "@/lib/api";

interface MigrationView { done: boolean; refused: Array<{ kind: string; key: string; reason: string }>; dismissed: boolean }
const WHAT: Record<string, string> = { slot: "A model you picked", order: "A model order you set", feature: "A feature switch", added_model: "A model you added" };

const FEATURE_WORD: Record<string, string> = { chat: "Chat", coding: "Coding", image: "Pictures", pictures: "Pictures", video: "Video", music: "Music", tts: "Voice", voice: "Voice", vision: "Vision" };
const LEVEL_WORD: Record<string, string> = { reduced: "Reduced", standard: "Standard", boost: "Boost", max: "Max" };
/** A refused value's key in the person's words: `image.max` is "Pictures, Max"; an order or a switch is its feature; an added model is its id. */
function plainKey(kind: string, key: string): string {
  const [feature, level] = key.split(".");
  const name = FEATURE_WORD[feature ?? ""];
  if (kind === "slot" && name && level && LEVEL_WORD[level]) return `${i18n._({ id: name, message: name })}, ${i18n._({ id: LEVEL_WORD[level]!, message: LEVEL_WORD[level]! })}`;
  if ((kind === "order" || kind === "feature") && FEATURE_WORD[key]) return i18n._({ id: FEATURE_WORD[key]!, message: FEATURE_WORD[key]! });
  return key;
}

export function AiMigrationNotice() {
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: ["ai", "stack", "migration"], queryFn: () => requestJson<MigrationView>("/api/ai/stack/migration") });
  const dismiss = useMutation({ mutationFn: () => requestJson<MigrationView>("/api/ai/stack/migration/dismiss", { method: "POST", body: "{}" }), onSuccess: (next) => queryClient.setQueryData(["ai", "stack", "migration"], next) });
  const data = view.data;
  if (!data || !data.done || data.dismissed || data.refused.length === 0) return null;
  return <section role="status" className="flex flex-col gap-2 rounded-2xl border p-4" data-testid="ai-migration-notice" aria-label={i18n._({ id: "Some earlier choices were not moved", message: "Some earlier choices were not moved" })}>
    <h3 className="font-semibold">{i18n._({ id: "Some earlier choices were not moved", message: "Some earlier choices were not moved" })}</h3>
    <p className="text-supporting text-muted-foreground">{i18n._({ id: "The engine now keeps your model choices. It did not take these, so they are still saved here and nothing was lost. Choose again below if you want them.", message: "The engine now keeps your model choices. It did not take these, so they are still saved here and nothing was lost. Choose again below if you want them." })}</p>
    <ul className="flex list-disc flex-col gap-1 ps-5 text-supporting">{data.refused.map((row) => <li key={`${row.kind}:${row.key}`}>{WHAT[row.kind] ? i18n._({ id: WHAT[row.kind]!, message: WHAT[row.kind]! }) : i18n._({ id: "An earlier choice", message: "An earlier choice" })} ({plainKey(row.kind, row.key)}): {row.reason}</li>)}</ul>
    <div><Button type="button" variant="outline" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>{i18n._({ id: "Got it", message: "Got it" })}</Button></div>
  </section>;
}
