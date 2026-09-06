// The frozen C-to-E contract for `WS /api/stt/stream`
// (docs/plans/wave-2.md's "C to E: speech to text", 2026-09-06). One
// definition both `sttSocket.ts`'s real and mock implementations import,
// so neither can silently drift from the other or from the route C
// hasn't shipped yet.
export interface SttHelloMessage {
  type: "hello";
  sample_rate: 16000;
}

export type SttServerMessage =
  | { type: "ready" }
  | { type: "vad"; speaking: boolean }
  | { type: "partial"; text: string }
  | { type: "final"; text: string; turn_id?: string }
  | { type: "no_speech" };
