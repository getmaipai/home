import { isDeviceConnected } from "@/lib/deviceCommands";
import { getDeviceState } from "@/lib/deviceStates";
import { requestListen, type ListenOutcome } from "@/lib/music/listenRequests";

export const SONG_NAME_TOOL_ID = "song_name";

export function songNameText(outcome: ListenOutcome): string {
  if (outcome.status === "matched") {
    const song = outcome.result;
    const details = [song.album || undefined, undefined].filter(Boolean).join(", ");
    return `That is ${song.title} by ${song.artist}${details ? ` (${details})` : ""}.`;
  }
  if (outcome.status === "no_match") return "I listened but could not tell which song that is.";
  if (outcome.status === "needs_confirm") return "I may have a match; the household has song naming set to ask first.";
  if (outcome.status === "not_ready") return outcome.line;
  if (outcome.status === "timeout") return "The robot did not answer in time.";
  if (outcome.status === "rate_limited") return "I could not listen again yet.";
  return "I could not identify the song just now.";
}

export async function runSongNameTool(input: { callId: string; deviceId?: string | null; surface: string }) {
  let text = "I can only listen through the robot right now.";
  try {
    if (input.surface === "robot" && input.deviceId) {
      const state = getDeviceState(input.deviceId);
      if (isDeviceConnected(input.deviceId) && state && state.reachable && !state.muted) text = songNameText(await requestListen(input.deviceId));
      else text = "The robot is not ready to listen right now.";
    }
  } catch { text = "I could not identify the song just now."; }
  return { callId: input.callId, packageId: SONG_NAME_TOOL_ID, status: "succeeded" as const, via: "tool_call" as const, args: {}, result: { reply: { text }, actions: [] }, durationMs: 0 };
}
