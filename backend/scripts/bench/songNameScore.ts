export interface SongNameRun {
  label: "song_name" | "N";
  called: boolean;
  passed?: boolean;
  action?: string;
  split?: "dev" | "heldout3";
}

export interface SongNameScore {
  songPass: number;
  songRuns: number;
  falseCalls: number;
  redirected: number;
  otherRuns: number;
  ok: boolean;
}

/** Score song_name recall and false calls over the per-repeat results. */
export function songNameScore(results: readonly SongNameRun[]): SongNameScore {
  const song = results.filter((r) => r.label === "song_name");
  const other = results.filter((r) => r.label === "N");
  const songPass = song.filter((r) => r.passed === true).length;
  const redirected = other.filter((r) => r.called && r.action === "playback").length;
  const falseCalls = other.filter((r) => r.called && r.action !== "playback").length;
  const songRuns = song.length;
  const otherRuns = other.length;
  return {
    songPass,
    songRuns,
    falseCalls,
    redirected,
    otherRuns,
    ok: songRuns > 0 && otherRuns > 0 && songPass / songRuns >= 0.9 && falseCalls / otherRuns <= 0.02,
  };
}
