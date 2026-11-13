// VOICE-TRACE-01: the recorder keeps event names from its list and numbers only, one upload per utterance, N utterances then off.
import { describe, expect, test } from "bun:test";
import { createVoiceTrace, VOICE_TRACE_EVENTS, voiceTraceUtterancesFromSearch, type VoiceTraceUpload } from "@/lib/voice/voiceTrace";

describe("VOICE-TRACE-01: the recorder", () => {
  test("records listed events with numbers, booleans and short tokens; drops unknown events, text and long strings", async () => {
    const posted: VoiceTraceUpload[] = [];
    let clock = 1000;
    const trace = createVoiceTrace(2, async (upload) => { posted.push(upload); }, () => clock);
    expect(trace.enabled).toBe(true);
    trace.note("session_open", { bargein: true });
    clock += 250;
    trace.note("edge", { words: 7, level: "gentle", score: 0.85, unfinished: false, text: "what is a good name for a small grey cat", note: "x".repeat(30) });
    trace.note("transcript" as never, { words: 3 }); // not in the list
    trace.note("final", { words: 7, nan: Number.NaN, nested: { a: 1 } as never });
    trace.endUtterance();
    await Promise.resolve();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.utterance).toBe(0);
    expect(posted[0]!.events).toEqual([
      { t: 0, e: "session_open", bargein: true },
      { t: 250, e: "edge", words: 7, level: "gentle", score: 0.9, unfinished: false },
      { t: 250, e: "final", words: 7 },
    ]);
    expect(JSON.stringify(posted[0])).not.toContain("grey cat");
    expect(trace.utterancesLeft).toBe(1);
    // The second utterance, then the recorder is spent: nothing more is recorded or posted.
    trace.note("vad_on"); trace.endUtterance();
    await Promise.resolve();
    expect(posted).toHaveLength(2);
    expect(trace.enabled).toBe(false);
    trace.note("vad_on"); trace.endUtterance(); trace.close();
    await Promise.resolve();
    expect(posted).toHaveLength(2);
  });

  test("closing posts whatever is pending once; an empty timeline posts nothing", async () => {
    const posted: VoiceTraceUpload[] = [];
    const trace = createVoiceTrace(3, async (upload) => { posted.push(upload); });
    trace.close();
    await Promise.resolve();
    expect(posted).toHaveLength(0);
    const trace2 = createVoiceTrace(3, async (upload) => { posted.push(upload); });
    trace2.note("ready", { granted: false, reason: "setting_off" });
    trace2.close();
    await Promise.resolve();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.events[0]).toMatchObject({ e: "ready", granted: false, reason: "setting_off" });
    expect(trace2.enabled).toBe(false);
  });

  test("the flag: ?voicetrace is 10 utterances, a number sets it (1 to 50), anything else is off", () => {
    expect(voiceTraceUtterancesFromSearch("")).toBe(0);
    expect(voiceTraceUtterancesFromSearch("?conversation=c1")).toBe(0);
    expect(voiceTraceUtterancesFromSearch("?voicetrace")).toBe(10);
    expect(voiceTraceUtterancesFromSearch("?voicetrace=")).toBe(10);
    expect(voiceTraceUtterancesFromSearch("?voicetrace=4&conversation=c1")).toBe(4);
    expect(voiceTraceUtterancesFromSearch("?voicetrace=500")).toBe(50);
    expect(voiceTraceUtterancesFromSearch("?voicetrace=0")).toBe(0);
    expect(voiceTraceUtterancesFromSearch("?voicetrace=abc")).toBe(0);
  });

  test("the vocabulary has no event that could carry words", () => {
    expect(VOICE_TRACE_EVENTS.every((name) => /^[a-z_]+$/.test(name))).toBe(true);
    expect(VOICE_TRACE_EVENTS).not.toContain("transcript" as never);
  });
});
