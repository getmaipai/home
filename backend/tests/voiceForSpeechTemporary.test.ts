// AUDIO-TEMPCHAT-01 (ruling 2026-11-07): voiceForSpeech has no notion of a temporary chat, so a temporary chat speaks the same voice a normal
// chat does, a saved household voice included, and saves nothing new. The age bands follow mayUseClipVoices (AUDIO-PARITY-01 V4): only a guest
// is held to the stock voices.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue, setPersonTtsVoiceUnchecked } from "@/lib/settings";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import type { PersonRow } from "@/types";

let n = 0;
function person(role: string): PersonRow { const now = new Date().toISOString(); const id = `person-tc${role}${++n}`; db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
beforeEach(() => resetDb());

describe("the voice a chat speaks does not depend on the chat being temporary", () => {
  for (const role of ["adult", "teen", "child"]) {
    test(`${role}: a saved household voice is spoken the same in a temporary chat and a normal chat`, () => {
      const p = person(role);
      // A child cannot choose their own voice, so the household default (set by an admin) is the saved voice every band shares.
      setHouseholdSettingValue("tts.home_voice", "cloned-voice-abc");
      if (role !== "child") setPersonTtsVoiceUnchecked(p, "cloned-voice-abc");
      const normal = voiceForSpeech({ actor: p });
      const temporary = voiceForSpeech({ actor: p }); // there is no temporary input: the call is identical by design
      expect(temporary).toBe(normal);
      expect(normal).toBe("cloned-voice-abc");
    });
  }
  test("a guest never speaks a saved household voice, temporary chat or not", () => {
    const g = person("guest");
    setHouseholdSettingValue("tts.home_voice", "cloned-voice-abc");
    expect(voiceForSpeech({ actor: g })).not.toBe("cloned-voice-abc");
  });
});
