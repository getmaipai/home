// FAST-03 keeps every package's manifest description to one short sentence a person would say (the store card, the confirm prompt).
// The longer tool-use instructions two tools were tuned with (their bench rounds) are the words the model must keep receiving,
// so they live here, unchanged, and `toolSpecFor` (nodes/model.ts) hands the model these in place of the short description.
export const TOOL_GUIDANCE: Readonly<Record<string, string>> = {
  impression: "Call with action start and a synth name when asked for an impression of, or to act as, a synth or person; do not ask first. Call with action stop when told to stop. Keeps its voice and memories.",
  song_name: "Name the song playing near the robot. listen: asked what it is or who performs it, quote their words in question. playback: pause, skip, repeat, volume, like or save; the robot cannot do those.",
};
