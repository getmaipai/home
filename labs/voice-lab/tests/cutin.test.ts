import { expect, test, describe } from "bun:test";
import { TurnManager } from "../src/turnManager";

/** A manager that is already speaking a reply, with a clock the test moves. */
function speaking() {
  let t = 0;
  const m = new TurnManager(() => t);
  m.configure({ talkOverMode: "pause_then_decide" });
  const step = (speech: boolean, ms = 32) => { t += ms; return m.frame(speech, t); };
  step(true); step(true); step(true); step(true);            // 96 ms of speech starts the turn
  for (let i = 0; i < 6; i++) step(false);                   // 192 ms of silence: check_turn
  m.transcriptReady("hi"); m.turnModel(0.8, true);           // commit
  m.firstAudioPlayed();
  expect(m.state).toBe("speaking");
  return { m, step };
}
const types = (commands: Array<{ type: string }>) => commands.map((c) => c.type);

describe("cut-in", () => {
  test("lowers the voice, then pauses at 250 ms of speech", () => {
    const { m, step } = speaking();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) seen.push(...types(step(true)));
    expect(seen.filter((x) => x === "duck").length).toBe(1);
    expect(seen.indexOf("duck")).toBeLessThan(seen.indexOf("pause"));
    expect(seen).toContain("pause");
    expect(m.state).toBe("speaking");
  });
  test("short gaps between words do not reset the count", () => {
    const { m, step } = speaking();
    const seen: string[] = [];
    for (let round = 0; round < 4; round++) { for (let i = 0; i < 3; i++) seen.push(...types(step(true))); for (let i = 0; i < 4; i++) seen.push(...types(step(false))); }
    expect(seen).toContain("pause");
    expect(seen).not.toContain("interrupt");
    expect(m.state).toBe("speaking");
  });
  test("a short noise lowers the voice and then brings it back", () => {
    const { m, step } = speaking();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) seen.push(...types(step(true)));
    for (let i = 0; i < 12; i++) seen.push(...types(step(false)));
    expect(seen).toEqual(["duck", "resume"]);
    expect(m.state).toBe("speaking");
  });
  test("its own voice (echo) never stops the reply", () => {
    const { m, step } = speaking();
    m.setEcho(true);
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) { m.setEcho(true); seen.push(...types(step(true))); }
    expect(seen).not.toContain("interrupt");
    expect(m.state).toBe("speaking");
  });
  test("pauses during a cut-in", () => {
    const { m, step } = speaking();
    let stopped = false;
    for (let i = 0; i < 9 && !stopped; i++) stopped = types(step(true)).includes("pause");
    expect(stopped).toBe(true);
  });
});


describe("pause then decide", () => {
  test("pause then resume for a short backchannel", () => {
    const { m, step } = speaking(); for (let i=0;i<9;i++) step(true);
    expect(types(m.cutTranscript("mm-hm", true))).toEqual(["backchannel"]);
  });
  test("pause then interrupt for a real phrase", () => {
    const { m, step } = speaking(); for (let i=0;i<9;i++) step(true);
    expect(types(m.cutTranscript("wait, stop", false))).toEqual(["interrupt"]);
    expect(m.state).toBe("user_speaking");
  });
  test("long uninterrupted speech interrupts at the maximum", () => {
    const { m, step } = speaking(); const seen:string[]=[]; for (let i=0;i<60;i++) seen.push(...types(step(true)));
    expect(seen).toContain("interrupt");
  });
});
