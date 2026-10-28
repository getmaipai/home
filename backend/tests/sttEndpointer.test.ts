// DUPLEX-02: the Stack-served end-of-turn check sits behind stack.engines.stt.smart_turn, off by default.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { getEndpointer, decodeWav } from "@/lib/sttSession";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { startStackFixture, type StackFixture } from "./stackFixture";

let fixture: StackFixture | undefined;
beforeEach(() => { setHouseholdSettingValue("stack.engines.stt.smart_turn", false); });
afterEach(() => { fixture?.stop(); fixture = undefined; __resetStackEngineForTests(); setHouseholdSettingValue("stack.engines.stt.smart_turn", false); });

const speech = new Float32Array(16_000).map((_, i) => 0.3 * Math.sin(i / 7));

test("the flag is off by default, so no endpointer exists and the silence timer decides", async () => {
  expect(await getEndpointer()).toBeNull();
});

test("with the flag on, the endpointer sends the utterance as a WAV to the Stack and returns its verdict", async () => {
  let received: { bytes: number; samples: number } | undefined;
  let verdict = false;
  fixture = startStackFixture({
    "POST /v1/audio/endpoint": async (req) => {
      const file = (await req.formData()).get("file") as unknown as Blob;
      const wav = new Uint8Array(await file.arrayBuffer());
      received = { bytes: wav.length, samples: decodeWav(wav).samples.length };
      return Response.json({ complete: verdict, probability: verdict ? 0.9 : 0.2 });
    },
  });
  __setStackClientForTests(fixture.client);
  expect(setHouseholdSettingValue("stack.engines.stt.smart_turn", true).ok).toBe(true);
  const endpointer = await getEndpointer();
  expect(endpointer).not.toBeNull();
  expect(await endpointer!.isComplete(speech, 16_000)).toBe(false);
  verdict = true;
  expect(await endpointer!.isComplete(speech, 16_000)).toBe(true);
  expect(received?.samples).toBe(16_000);
  expect(fixture.calls).toEqual(["POST /v1/audio/endpoint", "POST /v1/audio/endpoint"]);
});

test("a Stack that has no end-of-turn model makes the check throw, which the session treats as finished", async () => {
  fixture = startStackFixture({ "POST /v1/audio/endpoint": async () => Response.json({ error: "The end-of-turn model is not installed on this Stack yet.", reason: "endpoint-model-missing" }, { status: 503 }) });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("stack.engines.stt.smart_turn", true);
  await expect((await getEndpointer())!.isComplete(speech, 16_000)).rejects.toThrow();
});
