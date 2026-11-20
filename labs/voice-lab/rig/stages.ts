// Median stage breakdown from results/turns.jsonl (last N turns): where each 100 ms goes.
const n = Number(process.argv[2] ?? 30);
const rows = (await Bun.file(import.meta.dir + "/../results/turns.jsonl").text()).trim().split("\n").slice(-n).map((l) => JSON.parse(l)).filter((r) => r.t_first_frame_sent != null);
const med = (a: number[]) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]!) : NaN; };
const pairs: [string, string, string][] = [["silence to check", "t_check", "t_check"], ["check to transcript", "t_check", "t_transcript"], ["check to turn model", "t_check", "t_turn_model"], ["check to commit", "t_check", "t_commit"],
  ["transcript to LLM first token", "t_transcript", "t_llm_first_token"], ["LLM first token to first phrase", "t_llm_first_token", "t_first_phrase_ready"], ["first phrase to voice audio", "t_first_phrase_ready", "t_voice_first_audio"], ["voice audio to frame sent (held until commit)", "t_voice_first_audio", "t_first_frame_sent"], ["check to first frame sent", "t_check", "t_first_frame_sent"]];
console.log(`turns ${rows.length}; head start median ${med(rows.map((r) => r.draft_head_start_ms))} ms; commit reasons ${JSON.stringify(rows.reduce((a: any, r) => (a[r.commit_reason] = (a[r.commit_reason] ?? 0) + 1, a), {}))}`);
for (const [name, a, b] of pairs) console.log(name.padEnd(48), String(med(rows.map((r) => r[b] - (a === b ? 0 : r[a])))).padStart(6), "ms (median)");
