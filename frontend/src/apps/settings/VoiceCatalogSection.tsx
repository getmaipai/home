import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { titleCaseOption } from "@maipai/ui/src/settings/SettingField";
import { voiceDisplayName } from "@/lib/voice/voiceDisplayName";
import { readMicDevicePreference, writeMicDevicePreference } from "@/lib/voice/micDevicePreference";

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
  const currentCatalogLabel = currentIsCatalogVoice ? voiceDisplayName(currentValue!.replace("hf://kyutai/tts-voices/", "")) : null;

  return (
    <Section heading="More voices">
      {/* A review (2026-09-23): the microphone picker is a purely
       * local, offline concern (navigator.mediaDevices) - it used to
       * be nested inside the catalog's own loaded branch, so a
       * household with no internet, or hitting a Hugging Face outage,
       * could never reach it even though nothing about it depends on
       * the catalog. Rendered here, outside every catalog-state
       * branch below, so it's reachable regardless of whether the
       * (external) catalog ever loads. */}
      <MicrophoneSection />
      {!expanded ? (
        // w-fit (previously) sized this to its own unwrapped text width
        // regardless of the section's own available width - found live
        // at 390px, the label running off the card's own right edge
        // instead of wrapping (the screenshot pipeline's own per-panel
        // overflow check, HOME-UI-02d, is what caught it; the page-
        // level check before it never saw a sub-region's own overflow).
        // whitespace-normal + text-left: Button's own default is a
        // single nowrap line, wrong for a sentence this long on a
        // narrow screen.
        <Button type="button" variant="link" onClick={expand} className="h-auto min-h-12 w-full text-left whitespace-normal">
          Browse the full community voice catalog (2,000+ voices)
        </Button>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-[var(--destructive)]">{loadError}</p>
          <Button variant="secondary" onClick={expand}>
            Try again
          </Button>
        </div>
      ) : catalog === null ? (
        <Progress mode="spinner" label="Loading the voice catalog" />
      ) : (
        <div className="flex flex-col gap-2">
          {currentIsCatalogVoice ? (
            <p className="text-base text-[var(--muted-foreground)]">
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
          {selectError ? <p className="text-base text-[var(--destructive)]">{selectError}</p> : null}
          {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LENGTH ? (
            <p className="text-base text-[var(--muted-foreground)]">Keep typing to search.</p>
          ) : search.trim().length >= MIN_SEARCH_LENGTH && matches.length === 0 ? (
            <p className="text-base text-[var(--muted-foreground)]">No voices match "{search}".</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {matches.map((entry) => (
                <li key={entry.path} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-base">{voiceDisplayName(entry.path)}</span>
                    <span className="text-base text-[var(--muted-foreground)]">{titleCaseOption(entry.collection)}</span>
                  </div>
                  <Button
                    variant="secondary"

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

/** `MediaDeviceInfo.label` is empty until mic permission has been
 * granted at least once (browsers refuse to leak hardware names before
 * that) - the honest fallback name every OS does the same thing for. */
function micLabel(device: MediaDeviceInfo, index: number): string {
  return device.label || `Microphone ${index + 1}`;
}

/** The microphones the browser reports, refreshed on `devicechange` -
 * `enumerateDevices()` itself needs no permission prompt to call, only
 * to return real labels (see `micLabel` above). `navigator.mediaDevices`
 * itself is `undefined` in an insecure context (a review, 2026-09-23: a
 * self-hosted hub reached over plain-HTTP LAN, a plausible way to open
 * it, not just a test environment) - guarded here rather than letting
 * this section throw on mount. */
function useAudioInputDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    let cancelled = false;
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {
          if (!cancelled) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);
  return devices;
}

/** VOICE-LIVE-03b: moved here from the composer's chevron (owner's
 * ruling, 2026-09-23: voice controls belong in Settings, not on the
 * prompt bar) - the same code paths, a second control in this same
 * section rather than a section of its own, since it's the same
 * "who's listening/speaking for this person" concern the voice list
 * above already is. `RESP-04 (f)`'s own ruling ("a control with fewer
 * than two selectable entries renders nothing at all, never a disabled
 * trigger") applies here too - a single mic is the common household
 * case (one laptop, no external input) and there is nothing real to
 * choose between. Writes the per-browser preference
 * (`micDevicePreference.ts`) the dictation adapter reads on its own
 * next session - it never re-opens an already-live stream. */
function MicrophoneSection() {
  const devices = useAudioInputDevices();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(readMicDevicePreference());
  }, []);
  if (devices.length < 2) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <h3 className="text-base font-medium">Microphone</h3>
      <p className="text-base text-[var(--muted-foreground)]">The microphone choice is remembered on this device only.</p>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {devices.map((device, index) => {
          const active = selected === device.deviceId;
          return (
            <li key={device.deviceId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-base">{micLabel(device, index)}</span>
              <Button
                variant={active ? "default" : "secondary"}
                disabled={active}
                onClick={() => {
                  writeMicDevicePreference(device.deviceId);
                  setSelected(device.deviceId);
                }}
              >
                {active ? "In use" : "Use this microphone"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
