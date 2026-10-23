import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Section } from "@maipai/ui/src/primitives/Section";
import { api, ApiError, type RobotCompanionInfo, type StackVoice } from "@/lib/api";
import { voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";

const NONE = "none";
const CONTROLS = ["child", "teen", "adult"] as const;
const CONTROLS_LABEL: Record<string, string> = { child: "Child controls", teen: "Teen controls", adult: "Adult controls" };
const CONTROLS_NOTE: Record<string, string> = {
  child: "Every child protection applies, whichever companion is chosen.",
  teen: "Teen protections apply, whichever companion is chosen. Still no adult content.",
  adult: "Adult answers. Any companion can be chosen.",
};

/** "Speaking in Alba, from the companion Rivet." The voice the robot uses and why. */
function speakingLine(speaking: RobotCompanionInfo["speaking"], voices: StackVoice[]): string {
  const voice = speaking.voice_id === "default" ? null : voices.find((entry) => entry.id === speaking.voice_id);
  const name = speaking.voice_id === "default" ? "Home's default voice" : voice ? voiceFriendlyName(voice) : "a voice made at home";
  if (speaking.source === "companion") return `Speaking in ${name}, from the companion ${speaking.companion_name ?? "you chose"}.`;
  if (speaking.source === "robot") return `Speaking in ${name}, this robot's own voice.`;
  return speaking.voice_id === "default" ? "Speaking in Home's default voice." : `Speaking in ${name}, Home's default voice.`;
}

/** ROBOT-COMPANION-01: an admin picks a robot's controls and its companion. The robot's controls set which protections apply, whatever
 * the companion; a companion for everyone adapts to them, a teen or adult companion needs those controls. Only the companions the controls allow are listed, and the hub
 * refuses the rest with a sentence that says what to do (shown here as the destructive Alert). */
export function RobotCompanionChoices({ deviceId }: { deviceId: string }) {
  const [info, setInfo] = useState<RobotCompanionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<StackVoice[]>([]);
  useEffect(() => { let active = true; void api.stackVoices().then((result) => { if (active) setVoices(result.voices); }).catch(() => undefined); return () => { active = false; }; }, []);
  const load = useCallback(async () => {
    try { setInfo(await api.robotCompanion(deviceId)); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : "Could not load this robot's companion. Check the connection and try again."); }
  }, [deviceId]);
  useEffect(() => { void load(); }, [load]);

  async function save(key: "robot.controls" | "robot.companion.id", value: string): Promise<void> {
    setBusy(true);
    setError(null);
    try { await api.setSetting(`device:${deviceId}`, key, value); await load(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : "Could not save this. Check the connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <Section heading="Companion and controls">
      {!info ? (error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null) : <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`robot-controls-${deviceId}`}>Controls</FieldLabel>
          <Select aria-label="Controls" value={info.controls} options={[...CONTROLS]} getLabel={(value) => CONTROLS_LABEL[value] ?? value} disabled={busy} onValueChange={(value) => void save("robot.controls", value)} />
          <FieldDescription>{CONTROLS_NOTE[info.controls]}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`robot-companion-${deviceId}`}>Companion</FieldLabel>
          <Select
            aria-label="Companion"
            value={info.companion_id || NONE}
            options={[NONE, ...info.companions.map((companion) => companion.id)]}
            getLabel={(value) => value === NONE ? "None (child controls)" : (() => { const companion = info.companions.find((entry) => entry.id === value); return companion ? (companion.audience === "all" ? companion.name : `${companion.name} (${companion.audience} only)`) : value; })()}
            disabled={busy}
            onValueChange={(value) => void save("robot.companion.id", value === NONE ? "" : value)}
          />
          <FieldDescription>The companion sets how this robot talks. The controls above set which protections apply. Who is speaking does not change either. A teen or adult companion is listed only when the controls allow it.</FieldDescription>
        </Field>
        <FieldDescription>{speakingLine(info.speaking, voices)}</FieldDescription>
        {!info.home_location_set ? (
          <Alert><AlertDescription>The weather needs a Home location. <Link to="/settings/household?tab=general">Set it in Settings, Home, General.</Link></AlertDescription></Alert>
        ) : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </FieldGroup>}
    </Section>
  );
}
