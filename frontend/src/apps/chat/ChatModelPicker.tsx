import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type ChatModelsResponse, type ModelJob, type Roster } from "@/lib/api";
import type { EngineHealth } from "./useEngineHealth";

interface ChatModelPickerProps {
  person: Roster;
  health: EngineHealth | undefined;
}

function isMinor(role: Roster["role"]): boolean {
  return role === "child" || role === "teen";
}

function isOwner(role: Roster["role"]): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The everyday chat caption is intentionally much smaller than the AI
 * models settings card. A parent gets the current model name and, when they
 * are an owner/admin, a compact picker. Children never receive model data or
 * a model-shaped control; their caption stays the calm product name.
 */
export function ChatModelPicker({ person, health }: ChatModelPickerProps) {
  const childSafe = isMinor(person.role);
  const owner = isOwner(person.role);
  const [data, setData] = useState<ChatModelsResponse | null>(null);
  const [job, setJob] = useState<ModelJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (childSafe) return;
    let active = true;
    api.chatModels().then((value) => {
      if (active) setData(value);
    }).catch(() => {
      if (active) setError("The chat model could not be checked.");
    });
    return () => { active = false; };
  }, [childSafe]);

  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed" || job.status === "none") return;
    const timer = setInterval(() => {
      api.modelSelectStatus(job.modelId).then((next) => {
        setJob(next);
        if (next.status === "ready") {
          api.chatModels().then(setData).catch(() => {});
        }
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);

  if (childSafe) {
    return <span className="text-sm text-muted-foreground" aria-label="Current chat model">MaiPai</span>;
  }

  const selected = data?.selectedModel;
  const label = selected?.label ?? "MaiPai";
  const unavailable = selected !== null && selected !== undefined && !selected.available;
  const activeJob = job && job.status !== "ready" && job.status !== "failed" && job.status !== "none" ? job : null;
  const busy = activeJob !== null;
  const ChevronIcon = getIcon("chevron-down");

  const choose = async (modelId: string) => {
    setError(null);
    try {
      setJob(await api.selectModel(modelId));
    } catch {
      setError("That model needs attention. Try again or open AI models in Settings.");
    }
  };

  const caption = <span className="text-sm text-muted-foreground" aria-label={`Current chat model: ${label}`}>Using {label}</span>;
  if (!owner) return caption;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className="max-w-56 gap-1.5 overflow-hidden text-muted-foreground" aria-label={`Choose chat model (current: ${label})`}>
          {caption}
          <ChevronIcon className="size-3.5" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal forceMount>
        <Popover.Content forceMount side="bottom" align="end" sideOffset={8} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg data-[state=closed]:hidden">
          <h3 className="text-sm font-semibold">Chat model</h3>
          <p className="mt-1 text-base text-muted-foreground">Choose a model that fits this computer.</p>
          {error ? <p className="mt-3 text-base text-[var(--destructive)]">{error}</p> : null}
          {unavailable ? (
            <div className="mt-3 rounded-lg border border-border p-3">
              <p className="text-base">{label} needs attention.</p>
              <Button type="button" variant="secondary" className="mt-2" asChild><Link to="/settings/models">Open AI models</Link></Button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            {data?.models.map((model) => (
              <div key={model.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
                <span className="text-base">{model.label}</span>
                {model.id === selected?.id ? (
                  <span className="text-sm text-muted-foreground">Current</span>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => void choose(model.id)} disabled={busy}>Use this</Button>
                )}
              </div>
            ))}
          </div>
          {activeJob ? <p className="mt-3 text-base text-muted-foreground">Setting up {activeJob.modelId}…</p> : null}
          {job?.status === "failed" ? <p className="mt-3 text-base text-[var(--destructive)]">That model could not be started. Try again.</p> : null}
          {health?.brain === "stopped" ? <p className="mt-3 text-base text-muted-foreground">The AI is stopped. Restart it in Settings → AI models.</p> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
