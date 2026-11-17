import { i18n } from "@lingui/core";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { api } from "@/lib/api";
import { CompanionFlowDialog } from "@/shell/pages/companionFlow/CompanionFlowDialog";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

/** /companions/create (new) and /companions/:id/create (edit, starting from the current look). Children never reach it. */
export function CompanionFlowPage() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  // /companions/:id/create?step=2 opens editing on the animations screen, ?step=3 on the customize screen.
  const initialStep = search.get("step") === "3" ? 2 : search.get("step") === "2" ? 1 : 0;
  const list = useQuery({ queryKey: ["companions"], queryFn: () => api.companions(), retry: false });
  const existing = useQuery({ queryKey: ["companions", id, "edit"], queryFn: () => api.editCompanion(id!), enabled: Boolean(id) && list.data?.can_create === true, retry: false });
  if (list.isError) return <AsyncState data={null} error onRetry={() => void list.refetch()} errorMessage={flowErrorText(list.error)} loadingLabel={i18n._({ id: "Loading synths", message: "Loading synths" })}>{() => null}</AsyncState>;
  if (!list.data) return <AsyncState data={undefined} isFetching onRetry={() => void list.refetch()} loadingLabel={i18n._({ id: "Loading synths", message: "Loading synths" })}>{() => null}</AsyncState>;
  // UNSEEN-01 (C10): the flow is absent for a person who may not make one; its address sends them home without a word.
  if (!list.data.can_create) return <Navigate to="/" replace />;
  if (!id) return <CompanionFlowDialog companionId={null} initialName="" />;
  if (existing.isError) return <AsyncState data={null} error onRetry={() => void existing.refetch()} errorMessage={flowErrorText(existing.error)} loadingLabel={i18n._({ id: "Loading synth", message: "Loading synth" })}>{() => null}</AsyncState>;
  if (!existing.data) return <AsyncState data={undefined} isFetching onRetry={() => void existing.refetch()} loadingLabel={i18n._({ id: "Loading synth", message: "Loading synth" })}>{() => null}</AsyncState>;
  return <CompanionFlowDialog companionId={id} initialName={existing.data.name} initialStep={initialStep} />;
}
