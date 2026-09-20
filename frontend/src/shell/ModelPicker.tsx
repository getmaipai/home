import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HeaderPicker, type HeaderPickerStatus } from "@maipai/ui/src/blocks/dashboard/components/HeaderPicker";
import { isActiveNavPath } from "@maipai/ui/src/nav";
import { api, type ChatModelsResponse, type ModelJob, type Roster } from "@/lib/api";
import { canViewChatDetails, useChatDisclosure } from "@/apps/chat/useChatDisclosure";
import { activeJobOf } from "@/apps/settings/ModelsSection";

/** The chat model picker, in the header's own picker slot (spec.md "The
 * senses dock and the model picker": "not a chat control... the same
 * picker chrome as the profile switcher" - the kit's HeaderPicker, the
 * chrome the Stack's own machine selector generalized into). Route-gated
 * to /chat, and to the Developer disclosure level: "shows the
 * companion's current model only at the Developer disclosure level;
 * parents and kids see the companion, never a model name" - below that
 * level this renders nothing at all, not even a read-only caption; the
 * model stays switchable from Settings -> AI models either way. */
export function ModelPicker({ person }: { person: Roster }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [visible] = useChatDisclosure(person);
  const [data, setData] = useState<ChatModelsResponse | null>(null);
  const [job, setJob] = useState<ModelJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onChat = isActiveNavPath(location.pathname, "/chat");
  const eligible = onChat && canViewChatDetails(person.role) && visible === true;

  useEffect(() => {
    if (!eligible) return;
    let active = true;
    api.chatModels().then((value) => {
      if (active) setData(value);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [eligible]);

  useEffect(() => {
    const running = activeJobOf(job);
    if (!running) return;
    const timer = setInterval(() => {
      api.modelSelectStatus(running.modelId).then((next) => {
        setJob(next);
        if (next.status === "ready") api.chatModels().then(setData).catch(() => {});
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);

  if (!eligible || !data) return null;

  const selected = data.selectedModel;
  const activeJob = activeJobOf(job);
  const unavailable = selected !== null && selected !== undefined && !selected.available;
  const triggerStatus: HeaderPickerStatus = activeJob ? "warning" : error || unavailable || job?.status === "failed" ? "error" : null;
  const sublabel = activeJob
    ? `Setting up ${activeJob.modelId}…`
    : error
      ? error
      : job?.status === "failed"
        ? "That model could not be started. Try again."
        : unavailable
          ? `${selected?.label ?? "This model"} needs attention.`
          : undefined;

  const choose = async (modelId: string) => {
    setError(null);
    try {
      setJob(await api.selectModel(modelId));
    } catch {
      setError("That model needs attention. Try again or open AI models in Settings.");
    }
  };

  return (
    <HeaderPicker
      triggerIcon="box"
      triggerLabel="Chat model"
      triggerStatus={triggerStatus}
      current={{ id: selected?.id ?? "none", label: selected?.label ?? "MaiPai", sublabel, status: triggerStatus }}
      otherItems={data.models.filter((model) => model.id !== selected?.id).map((model) => ({ id: model.id, label: model.label }))}
      onSelectOther={(id) => void choose(id)}
      actions={[{ id: "open-ai-models", label: "Open AI models", icon: "settings", onSelect: () => navigate("/settings/models") }]}
    />
  );
}
