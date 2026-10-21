import { useEffect, useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Select } from "@maipai/ui/src/primitives/Select";
import { api, ApiError, type StackVoice } from "@/lib/api";
import { playableVoices, voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";

const DEFAULT = "default";

/** The settings key that holds one companion's voice (a hyphen in the id becomes an underscore, as the hub names it). */
export const companionVoiceKey = (companionId: string): string => `companion.voice.${companionId.replace(/-/g, "_")}`;

/** COMPANION-04-lite: an admin picks the voice one companion speaks with. A robot's own voice still wins; with none chosen the companion
 * speaks in Home's default voice. Saves the household setting `companion.voice.<id>`; the hub refuses a voice it does not have. */
export function CompanionVoiceSelect({ companionId, companionName, value, onSaved }: { companionId: string; companionName: string; value: string; onSaved?: (voiceId: string) => void }) {
  const [voices, setVoices] = useState<StackVoice[]>([]);
  const [current, setCurrent] = useState(value || DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setCurrent(value || DEFAULT), [value]);
  useEffect(() => { let active = true; void api.stackVoices().then((result) => { if (active) setVoices(playableVoices(result.voices)); }).catch(() => undefined); return () => { active = false; }; }, []);
  const labels = new Map(voices.map((voice) => [voice.id, voiceFriendlyName(voice)] as const));

  async function save(next: string): Promise<void> {
    setBusy(true);
    setError(null);
    try { await api.setSetting("household", companionVoiceKey(companionId), next); setCurrent(next); onSaved?.(next); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : "Could not save this voice. Check the connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <Field>
      <FieldLabel htmlFor={`companion-voice-${companionId}`}>Voice</FieldLabel>
      <Select aria-label={`${companionName}'s voice`} value={current} options={[DEFAULT, ...voices.map((voice) => voice.id)]} getLabel={(id) => id === DEFAULT ? "Home's default voice" : labels.get(id) ?? "A voice made at home"} disabled={busy} onValueChange={(next) => void save(next)} />
      <FieldDescription>{error ?? `${companionName} speaks in this voice on any robot that has no voice of its own.`}</FieldDescription>
    </Field>
  );
}
