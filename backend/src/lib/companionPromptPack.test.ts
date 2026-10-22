import { expect, test } from "bun:test";
import media from "@maipai/spec/vocab/companion-media.json";
import { lookPromptFor } from "@/lib/companionLook";
import { TAKE_NEGATIVE_PROMPT, takePrompt } from "@/lib/companionTakes";
import { clipPromptPack, picturePromptPack } from "@/lib/companionPromptPack";
import { loadManifestOnly } from "@/lib/plugins";

const loaded = loadManifestOnly("rivet");
if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
const companion = { ...loaded.value.companion, display_name: "Pip", look_prompt: "A friendly orange fox" };

test("picture packs use the generator prompt and vocab values for both key colours", () => {
  for (const key of [media.key.default, media.key.alternate]) {
    const pack = picturePromptPack(companion, { key });
    const colour = key === media.key.default ? "green" : "magenta";
    expect(pack.prompt).toBe(lookPromptFor(companion.look_prompt!, key));
    expect(pack.text).toContain(`Prompt: ${pack.prompt}`);
    expect(pack.text).toContain(`Size: ${media.image.size} x ${media.image.size} pixels, square, PNG`);
    expect(pack.text).toContain(`about ${media.image.margin_percent} percent empty margin`);
    expect(pack.text).toContain(`Background: one flat solid colour, ${colour} (${key})`);
    expect(pack.text).not.toContain("—");
    expect(pack.text).toBe([
      "Character picture for Pip",
      `Prompt: ${lookPromptFor(companion.look_prompt!, key)}`,
      "Negative prompt: text, letters, watermark, shadow, ground, floor, props, other characters, cropped body, extra limbs",
      `Size: ${media.image.size} x ${media.image.size} pixels, square, PNG`,
      `Background: one flat solid colour, ${colour} (${key}), no gradient, no shadow, no ground. Home removes this colour afterwards, so it must not appear on the character.`,
      ...(colour === "green" ? ["If your tool cannot make exactly #00FF00, any flat single green is fine."] : []),
      "Transparency: If your tool can make a transparent PNG, ask for a transparent background instead and say so when you upload it. Otherwise keep the flat background.",
      `Pose and framing: one character, full body, centred, about ${media.image.margin_percent} percent empty margin on every side, standing relaxed, facing the viewer, mouth closed, arms down, simple clean illustration with flat colours.`,
      "Make several and pick one. Bring it back with Upload a picture in the Look tab (you will be asked to confirm you made it or have the right to use it).",
    ].join("\n"));
  }
  const empty = picturePromptPack({ ...companion, look_prompt: "" }, { key: media.key.default });
  expect(empty.prompt).toBe("Write the look prompt first.");
  expect(empty.text).toContain("Prompt: Write the look prompt first.");
  expect(empty.text).toContain(`Size: ${media.image.size} x ${media.image.size} pixels, square, PNG`);
});

test("clip packs use generator prompt, motion override and vocab specification for loops and one-shots", () => {
  const look = { key: media.key.default, sheet: { key: media.key.alternate, state: "approved", card: { text: "A tiny fox with a blue scarf" } } };
  for (const state of media.states.filter((row) => row.id === "idle" || row.id === "greeting")) {
    const override = "waves once, then rests";
    const pack = clipPromptPack(companion, look, state.id, override);
    const label = state.id.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
    expect(pack.title).toBe(`Character clip: ${label} for Pip`);
    expect(pack.text).toContain(`Plays when: ${state.driven_by}`);
    expect(pack.text).toContain(`Kind: ${state.kind === "loop" ? "loops" : "plays once"}`);
    expect(pack.prompt).toBe(takePrompt({ text: look.sheet.card.text }, override, "magenta"));
    expect(pack.text).toContain(`Prompt: ${pack.prompt}`);
    expect(pack.text).toContain(`Activity: ${override}`);
    expect(pack.text).toContain(`Duration and size: ${media.generate.seconds} seconds (${media.generate.frames} frames at ${media.generate.fps} fps), ${media.generate.width} x ${media.generate.height} pixels (square), no sound.`);
    expect(pack.text).toContain(`at most ${media.upload_video.max_seconds} seconds and ${media.upload_video.max_bytes / (1024 * 1024)} MB`);
    expect(pack.text).not.toContain("—");
    expect(pack.text).toContain(state.kind === "loop" ? "The last frame should flow into the first" : "It starts and ends in the same relaxed pose.");
    expect(pack.negative_prompt).toBe(TAKE_NEGATIVE_PROMPT);
    expect(pack.text).toBe([
      `Character clip: ${label} for Pip`,
      `Plays when: ${state.driven_by}`,
      `Kind: ${state.kind === "loop" ? "loops" : "plays once"}`,
      `Start from: the approved starting picture of Pip as the first frame (attach it as the image to animate). Do not change the character.`,
      `Prompt: ${takePrompt({ text: look.sheet.card.text }, override, "magenta")}`,
      `Activity: ${override}`,
      `Negative prompt: ${TAKE_NEGATIVE_PROMPT}`,
      `Duration and size: ${media.generate.seconds} seconds (${media.generate.frames} frames at ${media.generate.fps} fps), ${media.generate.width} x ${media.generate.height} pixels (square), no sound.`,
      "Camera: locked, no zoom, no pan, no cuts; the character stays centred and the same size.",
      "Background: the same flat solid magenta as the start picture, no shadow, no ground. Home removes it afterwards.",
      "Transparency: If your tool can export a transparent video (WebM with alpha), do that and tick \"This clip has a transparent background\" when you upload it. Otherwise keep the flat background.",
      state.kind === "loop" ? "Loop: The last frame should flow into the first so it can repeat without a visible jump." : "Loop: It starts and ends in the same relaxed pose.",
      `Bring it back with Upload a clip on the ${label} card in the States tab: MP4, MOV or WebM, at most ${media.upload_video.max_seconds} seconds and ${media.upload_video.max_bytes / (1024 * 1024)} MB. Home cuts out the background, fits the loop and checks the colours.`,
    ].join("\n"));
  }
  const fallback = clipPromptPack(companion, { key: media.key.default, sheet: null }, "idle");
  expect(fallback.prompt).toBe(takePrompt({ text: companion.look_prompt! }, media.states.find((row) => row.id === "idle")!.motion, "green"));
  expect(fallback.text).toContain("Start from: the starting picture you pick in the Look tab");
});
