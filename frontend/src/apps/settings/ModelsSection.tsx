import { useCallback, useEffect, useState } from "react";
import { Section } from "@/kit/primitives/Section";
import { Progress } from "@/kit/primitives/Progress";
import { api, ApiError, type HardwareInfo, type ModelFit } from "@/lib/api";
import { formatBytes } from "@/apps/settings/formatBytes";

// The model-selection wizard's informational half (2026-09-04): what
// hardware this box actually has, and which catalog models
// (backend/src/lib/modelCatalog.ts) fit it, with the dad-simple
// pros/cons the household chose over letting the system silently pick
// "the best" model for them. Deliberately read-only: there is no
// download queue or engine-launch wiring yet (spec/llm/README.md's "no
// GGUF is downloaded... no llama-server binary is fetched"), so a
// "choose this" button here would look actionable and do nothing -
// worse than not having one. The chat role is the only one with a real
// engine (llm.ts's IMPLEMENTED_ROLES); image/video entries are shown for
// their pros/cons since the wizard already researched and decided them,
// each visibly marked as not runnable yet rather than hidden.
export function ModelsSection() {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [chatFits, setChatFits] = useState<ModelFit[] | null>(null);
  const [imageFits, setImageFits] = useState<ModelFit[] | null>(null);
  const [videoFits, setVideoFits] = useState<ModelFit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api.hardware(),
      api.models("chat"),
      api.models("image"),
      api.models("video"),
    ])
      .then(([hw, chat, image, video]) => {
        setHardware(hw);
        setChatFits(chat);
        setImageFits(image);
        setVideoFits(video);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load hardware info."));
  }, []);

  useEffect(load, [load]);

  return (
    <Section heading="AI models">
      {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
      {hardware === null ? (
        <Progress mode="spinner" label="Detecting hardware" />
      ) : (
        <>
          <p className="text-base text-[hsl(var(--muted-foreground))]">{describeHardware(hardware)}</p>
          <FitList title="Chat" fits={chatFits} />
          <FitList title="Image generation" fits={imageFits} />
          <FitList title="Video generation" fits={videoFits} />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Downloading and running a different model isn't built yet: this shows what would fit.
          </p>
        </>
      )}
    </Section>
  );
}

function describeHardware(hw: HardwareInfo): string {
  if (hw.isAppleSilicon) return `This computer: Apple Silicon, ${hw.unifiedMemoryGb} GB memory.`;
  if (hw.cudaDevices.length > 0) {
    const cards = hw.cudaDevices.map((d) => `${d.name} (${formatBytes(d.vramBytes)})`).join(", ");
    return `This computer: ${cards}.`;
  }
  return `This computer: no graphics card detected, ${hw.totalRamGb} GB memory. AI models will run slowly.`;
}

function FitList({ title, fits }: { title: string; fits: ModelFit[] | null }) {
  if (fits === null) return null;
  if (fits.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-2">
        {fits.map((fit) => (
          <div key={fit.model.id} className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{fit.model.label}</span>
              <span className={fit.fits ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}>
                {fit.fits ? "Fits this computer" : "Doesn't fit this computer"}
              </span>
            </div>
            {!fit.model.implemented ? (
              <p className="text-[hsl(var(--muted-foreground))]">Not runnable yet, recorded for when this is built.</p>
            ) : null}
            {(fit.model.pros ?? []).map((pro) => (
              <p key={pro} className="text-[hsl(var(--muted-foreground))]">
                + {pro}
              </p>
            ))}
            {(fit.model.cons ?? []).map((con) => (
              <p key={con} className="text-[hsl(var(--muted-foreground))]">
                − {con}
              </p>
            ))}
            <p className="text-[hsl(var(--muted-foreground))]">Needs about {formatBytes(fit.requiredBytes)}.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
