import { isDeviceConnected } from "@/lib/deviceCommands";
import { getDeviceState } from "@/lib/deviceStates";
import { requestListen, type ListenOutcome } from "@/lib/music/listenRequests";
import { confirmHeardSong, findHeardCandidate, heardSongFor, rejectHeardSong } from "@/lib/music/heardSong";
import { issueDeviceCommand } from "@/lib/deviceCommands";

export const SONG_NAME_TOOL_ID = "song_name";
export type SongNameArgs = { action?: "listen" | "reject" | "suggest" | "confirm"; title?: string };

/** What the robot shows: the same `Title - Artist` form the body sets when it names a song itself. */
function shownTitle(song: { title: string; artist?: string | null }): string { return song.artist ? `${song.title} - ${song.artist}` : song.title; }

export function sendSongTitle(deviceId: string, text: string): void {
  try { issueDeviceCommand(deviceId, "song_title" as never, { text: text.slice(0, 80) }, 60_000); } catch { /* command delivery never fails the answer */ }
}

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

export async function runSongNameTool(input: { callId: string; deviceId?: string | null; surface: string; args?: SongNameArgs; command?: (deviceId: string, text: string) => void }) {
  let text = "I can only listen through the robot right now.";
  try {
    if (input.surface === "robot" && input.deviceId) {
      const action = input.args?.action ?? "listen";
      const titleCommand = (text: string) => { try { (input.command ?? sendSongTitle)(input.deviceId!, text); } catch { /* command delivery never fails the answer */ } };
      if (action !== "listen") {
        const current = heardSongFor(input.deviceId);
        if (!current) text = "I do not have a recent song guess to discuss.";
        else if (action === "reject") {
          const next = rejectHeardSong(input.deviceId);
          if (next) { text = `Then it may be ${next.title}${next.artist ? ` by ${next.artist}` : ""} (heard by ${next.source === "library" ? "your library" : next.source === "shazam" ? "Shazam" : "AcoustID"}). Does that sound right?`; titleCommand(shownTitle(next)); }
          else { text = "I have no other guess. I can listen again."; titleCommand(""); }
        } else if (action === "suggest") {
          const found = findHeardCandidate(input.deviceId, input.args?.title ?? "");
          text = found ? `Yes, ${found.candidate.source === "library" ? "your library" : found.candidate.source === "shazam" ? "Shazam" : "AcoustID"} also suggested that.` : `No service suggested that; I only heard ${current.title}${current.artist ? ` by ${current.artist}` : ""}.`;
        } else {
          const confirmed = confirmHeardSong(input.deviceId, input.args?.title);
          text = confirmed ? `Got it, that is ${confirmed.title}${confirmed.artist ? ` by ${confirmed.artist}` : ""}.` : "I do not have a recent song guess to confirm.";
          if (confirmed && confirmed.title !== current.title) titleCommand(shownTitle(confirmed));
        }
      } else {
        const state = getDeviceState(input.deviceId);
        if (isDeviceConnected(input.deviceId) && state && state.reachable && !state.muted) text = songNameText(await requestListen(input.deviceId));
        else text = "The robot is not ready to listen right now.";
      }
    }
  } catch { text = "I could not identify the song just now."; }
  return { callId: input.callId, packageId: SONG_NAME_TOOL_ID, status: "succeeded" as const, via: "tool_call" as const, args: {}, result: { reply: { text }, actions: [] }, durationMs: 0 };
}
