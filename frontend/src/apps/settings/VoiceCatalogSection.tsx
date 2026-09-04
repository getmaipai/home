import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Section } from "@/kit/primitives/Section";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";
import { Progress } from "@/kit/primitives/Progress";
import { titleCaseOption } from "@/kit/settings/SettingField";

interface VoiceCatalogSectionProps {
  personId: string;
}

interface CatalogEntry {
  path: string;
  collection: string;
}

const MIN_SEARCH_LENGTH = 2;
const MAX_RESULTS_SHOWN = 40;

// The rest of the community voice catalog (2026-09-04, item 3 of the
// Pocket TTS follow-ups): ~2,069 real files in `kyutai/tts-voices`
// beyond the 26 built-in presets `tts.voice_id`'s own generic dropdown
// already offers (SettingsRenderer's "Speaking voice" field, right
// above this section). Writes through a dedicated, server-validated
// route (POST /api/voice/catalog/select), not the generic settings PUT
// route - `tts.voice_id`'s `select` selector only ever accepts the 26
// curated names there, on purpose (backend/src/lib/settings.ts's
// setPersonTtsVoiceUnchecked() doc comment explains why). A catalog pick
// doesn't show up in that dropdown afterward (its own `select` control
// only recognizes its 26 known options) - this section shows the
// current value itself instead, so picking a catalog voice never looks
// like it silently did nothing.
export function VoiceCatalogSection({ personId }: VoiceCatalogSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [currentValue, setCurrentValue] = useState<string | null>(null);

  async function expand() {
    setExpanded(true);
    if (catalog !== null) return;
    setLoadError(null);
    try {
      const [catalogRes, values] = await Promise.all([api.voiceCatalog(), api.settingsValues(`person:${personId}`)]);
      setCatalog(catalogRes.entries);
      const voice = values.find((v) => v.key === "tts.voice_id");
      setCurrentValue(typeof voice?.value === "string" ? voice.value : null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load the voice catalog.");
    }
  }

  const matches = useMemo(() => {
    if (!catalog || search.trim().length < MIN_SEARCH_LENGTH) return [];
    const q = search.trim().toLowerCase();
    return catalog.filter((e) => e.path.toLowerCase().includes(q)).slice(0, MAX_RESULTS_SHOWN);
  }, [catalog, search]);

  async function selectVoice(path: string) {
    setPendingPath(path);
    setSelectError(null);
    try {
      const updated = await api.selectVoiceFromCatalog(path);
      setCurrentValue(typeof updated.value === "string" ? updated.value : null);
    } catch (e) {
      setSelectError(e instanceof ApiError ? e.message : "Could not set that voice.");
    } finally {
      setPendingPath(null);
    }
  }

  const currentIsCatalogVoice = currentValue?.startsWith("hf://kyutai/tts-voices/") ?? false;
  const currentCatalogLabel = currentIsCatalogVoice ? currentValue!.replace("hf://kyutai/tts-voices/", "") : null;

  return (
    <Section heading="More voices">
      {!expanded ? (
        <button type="button" onClick={expand} className="w-fit text-sm text-[hsl(var(--primary))] hover:underline">
          Browse the full community voice catalog (2,000+ voices)
        </button>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-[hsl(var(--destructive))]">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={expand}>
            Try again
          </Button>
        </div>
      ) : catalog === null ? (
        <Progress mode="spinner" label="Loading the voice catalog" />
      ) : (
        <div className="flex flex-col gap-2">
          {currentIsCatalogVoice ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Currently using a catalog voice: {currentCatalogLabel}
            </p>
          ) : null}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name (e.g. vctk, ears, expresso)"
            aria-label="Search the voice catalog"
            className="w-full"
          />
          {selectError ? <p className="text-sm text-[hsl(var(--destructive))]">{selectError}</p> : null}
          {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LENGTH ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Keep typing to search.</p>
          ) : search.trim().length >= MIN_SEARCH_LENGTH && matches.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No voices match "{search}".</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {matches.map((entry) => (
                <li key={entry.path} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-sm">{entry.path.split("/").pop()}</span>
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">{titleCaseOption(entry.collection)}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pendingPath === entry.path}
                    onClick={() => selectVoice(entry.path)}
                  >
                    {pendingPath === entry.path ? "Setting…" : "Use this voice"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
