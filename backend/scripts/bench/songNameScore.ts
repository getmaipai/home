export interface SongNameRun {
  label: "song_name" | "N";
  called: boolean;
  passed?: boolean;
}

export interface SongNameScore {
  songPass: number;
  songRuns: number;
  falseCalls: number;
  otherRuns: number;
  ok: boolean;
}

/** Score song_name recall and false calls over the per-repeat results. */
export function songNameScore(results: readonly SongNameRun[]): SongNameScore {
  const song = results.filter((r) => r.label === "song_name");
  const other = results.filter((r) => r.label === "N");
  const songPass = song.filter((r) => r.passed === true).length;
  const falseCalls = other.filter((r) => r.called).length;
  const songRuns = song.length;
  const otherRuns = other.length;
  return {
    songPass,
    songRuns,
    falseCalls,
    otherRuns,
    ok: songRuns > 0 && otherRuns > 0 && songPass / songRuns >= 0.9 && falseCalls / otherRuns <= 0.02,
  };
}
