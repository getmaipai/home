import type { PersonRow } from "@/types";
import { setValue, getDeviceSettingValue } from "@/lib/settings";
import { getDeviceById } from "@/lib/devices";
import { listSynths, maySeeSynth, synthById, synthFloor } from "@/lib/synths";
import { companionFits, ROBOT_GUISE_KEY, robotControlsOf } from "@/lib/robotCompanion";
import { canWritePersonMemory } from "@/lib/access";
import { remember } from "@/lib/memory";
import { localDayKey, hubTimeZone } from "@/lib/news/dayParts";
import { publishSettingsChanged } from "@/lib/deviceCommands";
import { renderClipBundle } from "@/lib/robotClips";
import type { AgeBand } from "@/lib/ageBand";

export const IMPRESSION_UNKNOWN_LINE = "That synth could not be found. Check its ID and try again.";
const REFUSAL = "That synth cannot be used for this speaker or device.";
function rememberGuise(actor: PersonRow, synthId: string, text: string): void {
  if (!canWritePersonMemory(actor, actor.id)) return;
  try { remember(actor, { text, category: "event", tier: "observation", scope: "person", person: actor.id, source: "robot.guise", importance: 0.5, skip_dedupe: true }); } catch { /* The guise succeeds even when its optional memory record cannot be saved. */ }
}
export function impressionAvailable(actor: PersonRow, band: AgeBand, deviceId: string): boolean {
  return listSynths(actor).some((synth) => synth.private_to === null && maySeeSynth(actor, synth) && companionFits(band, synthFloor(synth)) && companionFits(robotControlsOf(deviceId), synthFloor(synth)));
}
function eligible(actor: PersonRow, deviceId: string, synthId: string, band: AgeBand) {
  const synth = synthById(synthId);
  if (!synth || synth.private_to !== null || !maySeeSynth(actor, synth) || !companionFits(band, synthFloor(synth)) || !companionFits(robotControlsOf(deviceId), synthFloor(synth))) return null;
  return synth;
}
export async function runImpressionTool(input: { actor: PersonRow; args: Record<string, unknown>; deviceId?: string; band: AgeBand; identified?: boolean }): Promise<string> {
  const action = input.args.action === "stop" ? "stop" : "start";
  const deviceId = input.deviceId;
  if (!deviceId || getDeviceById(deviceId)?.kind !== "robot") return "This impression is available on the robot only.";
  const current = getDeviceSettingValue(deviceId, ROBOT_GUISE_KEY);
  if (action === "stop") {
    if (input.identified === false) return REFUSAL;
    if (typeof current === "string" && current) {
      const synth = synthById(current), name = synth?.persona.display_name ?? current, date = localDayKey(new Date(), hubTimeZone());
      if (synth) rememberGuise(input.actor, synth.id, `I stopped appearing as ${name} on the robot on ${date}.`);
    }
    const saved = setValue(input.actor, `device:${deviceId}`, ROBOT_GUISE_KEY, "");
    if (!saved.ok) return "The impression could not be stopped. Try again.";
    publishSettingsChanged(`device:${deviceId}`, ROBOT_GUISE_KEY, ""); void renderClipBundle(deviceId);
    return "Impression stopped.";
  }
  const requested = typeof input.args.synth === "string" ? input.args.synth.trim() : "";
  const synth = synthById(requested) ?? listSynths(input.actor).find((item) => item.id.toLowerCase() === requested.toLowerCase() || item.persona.display_name.toLowerCase() === requested.toLowerCase());
  if (!synth || synth.private_to !== null || !maySeeSynth(input.actor, synth)) return IMPRESSION_UNKNOWN_LINE;
  if (!eligible(input.actor, deviceId, synth.id, input.band)) return IMPRESSION_UNKNOWN_LINE;
  const saved = setValue(input.actor, `device:${deviceId}`, ROBOT_GUISE_KEY, synth.id);
  if (!saved.ok) return REFUSAL;
  publishSettingsChanged(`device:${deviceId}`, ROBOT_GUISE_KEY, synth.id);
  void renderClipBundle(deviceId);
  const date = localDayKey(new Date(), hubTimeZone());
  rememberGuise(input.actor, synth.id, `I had the robot take on ${synth.persona.display_name} on ${date}.`);
  return "Impression started.";
}

