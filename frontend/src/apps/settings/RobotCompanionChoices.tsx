import { i18n } from "@lingui/core";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Section } from "@maipai/ui/src/primitives/Section";
import { api, type RobotCompanionInfo, type StackVoice } from "@/lib/api";
import { voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";
import { errorLine } from "@/lib/hubReachability";

const NONE = "none";
const CONTROLS = ["child", "teen", "adult"] as const;
const controlsLabel = (): Record<string, string> => ({ child: i18n._({ id: "Child controls", message: "Child controls" }), teen: i18n._({ id: "Teen controls", message: "Teen controls" }), adult: i18n._({ id: "Adult controls", message: "Adult controls" }) });
const controlsNote = (): Record<string, string> => ({
  child: i18n._({ id: "Every child protection applies, whichever companion is chosen.", message: "Every child protection applies, whichever companion is chosen." }),
  teen: i18n._({ id: "Teen protections apply, whichever companion is chosen. Still no adult content.", message: "Teen protections apply, whichever companion is chosen. Still no adult content." }),
  adult: i18n._({ id: "Adult answers. Any companion can be chosen.", message: "Adult answers. Any companion can be chosen." }),
});

/** "Speaking in Alba, from the companion Rivet." The voice the robot uses and why. */
function speakingLine(speaking: RobotCompanionInfo["speaking"], voices: StackVoice[]): string {
  const voice = speaking.voice_id === "default" ? null : voices.find((entry) => entry.id === speaking.voice_id);
  const name = speaking.voice_id === "default" ? i18n._({ id: "Home's default voice", message: "Home's default voice" }) : voice ? voiceFriendlyName(voice) : i18n._({ id: "a voice made at home", message: "a voice made at home" });
  if (speaking.source === "companion") return i18n._({ id: "Speaking in {name}, from the companion {companion}.", message: "Speaking in {name}, from the companion {companion}.", values: { name, companion: speaking.companion_name ?? i18n._({ id: "you chose", message: "you chose" }) } });
  if (speaking.source === "robot") return i18n._({ id: "Speaking in {name}, this robot's own voice.", message: "Speaking in {name}, this robot's own voice.", values: { name } });
  return speaking.voice_id === "default" ? i18n._({ id: "Speaking in Home's default voice.", message: "Speaking in Home's default voice." }) : i18n._({ id: "Speaking in {name}, Home's default voice.", message: "Speaking in {name}, Home's default voice.", values: { name } });
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
    catch (failure) { setError(errorLine(failure, i18n._({ id: "Could not load this robot's companion. Check the connection and try again.", message: "Could not load this robot's companion. Check the connection and try again." }))); }
  }, [deviceId]);
  useEffect(() => { void load(); }, [load]);

  async function save(key: "robot.controls" | "robot.companion.id", value: string): Promise<void> {
    setBusy(true);
    setError(null);
    try { await api.setSetting(`device:${deviceId}`, key, value); await load(); }
    catch (failure) { setError(errorLine(failure, i18n._({ id: "Could not save this. Check the connection and try again.", message: "Could not save this. Check the connection and try again." }))); }
    finally { setBusy(false); }
  }

  return (
    <Section heading={i18n._({ id: "Companion and controls", message: "Companion and controls" })}>
      {!info ? (error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null) : <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`robot-controls-${deviceId}`}>{i18n._({ id: "Controls", message: "Controls" })}</FieldLabel>
          <Select aria-label={i18n._({ id: "Controls", message: "Controls" })} value={info.controls} options={[...CONTROLS]} getLabel={(value) => controlsLabel()[value] ?? value} disabled={busy} onValueChange={(value) => void save("robot.controls", value)} />
          <FieldDescription>{controlsNote()[info.controls]}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`robot-companion-${deviceId}`}>{i18n._({ id: "Companion", message: "Companion" })}</FieldLabel>
          <Select
            aria-label={i18n._({ id: "Companion", message: "Companion" })}
            value={info.companion_id || NONE}
            options={[NONE, ...info.companions.map((companion) => companion.id)]}
            getLabel={(value) => value === NONE ? i18n._({ id: "None (child controls)", message: "None (child controls)" }) : (() => { const companion = info.companions.find((entry) => entry.id === value); return companion ? (companion.audience === "all" ? companion.name : i18n._({ id: "{name} ({audience} only)", message: "{name} ({audience} only)", values: { name: companion.name, audience: companion.audience } })) : value; })()}
            disabled={busy}
            onValueChange={(value) => void save("robot.companion.id", value === NONE ? "" : value)}
          />
          <FieldDescription>{i18n._({ id: "The companion sets how this robot talks. The controls above set which protections apply. Who is speaking does not change either. A teen or adult companion is listed only when the controls allow it.", message: "The companion sets how this robot talks. The controls above set which protections apply. Who is speaking does not change either. A teen or adult companion is listed only when the controls allow it." })}</FieldDescription>
        </Field>
        <FieldDescription>{speakingLine(info.speaking, voices)}</FieldDescription>
        {!info.home_location_set ? (
          <Alert><AlertDescription>{i18n._({ id: "The weather needs a Home location.", message: "The weather needs a Home location." })} <Link to="/settings/household?tab=general">{i18n._({ id: "Set it in Settings, Home, General.", message: "Set it in Settings, Home, General." })}</Link></AlertDescription></Alert>
        ) : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </FieldGroup>}
    </Section>
  );
}
