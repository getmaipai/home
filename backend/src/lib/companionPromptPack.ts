import media from "@maipai/spec/vocab/companion-media.json";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { lookPromptFor } from "@/lib/companionLook";
import { TAKE_NEGATIVE_PROMPT, takePrompt } from "@/lib/companionTakes";

type Companion = NonNullable<PackageManifest["companion"]>;
type Look = { key: string; sheet?: { key: string; state?: string; card: { text: string } | null } | null };
export type CompanionPromptPack = { title: string; prompt: string; negative_prompt: string; text: string };

const pictureNegative = "text, letters, watermark, shadow, ground, floor, props, other characters, cropped body, extra limbs";
const keyName = (key: string): "green" | "magenta" => key.toUpperCase() === media.key.alternate ? "magenta" : "green";
const lines = (title: string, prompt: string, negative: string, rest: string[]) => ({ title, prompt, negative_prompt: negative, text: [title, `Prompt: ${prompt}`, `Negative prompt: ${negative}`, ...rest].join("\n") });

export function picturePromptPack(companion: Companion, look: Look): CompanionPromptPack {
  const displayName = companion.display_name;
  const title = `Character picture for ${displayName}`;
  const prompt = companion.look_prompt?.trim() ? lookPromptFor(companion.look_prompt, look.key) : "Write the look prompt first.";
  const colour = keyName(look.key);
  const colourHex = colour === "green" ? media.key.default : media.key.alternate;
  const background = `one flat solid colour, ${colour} (${colourHex}), no gradient, no shadow, no ground. Home removes this colour afterwards, so it must not appear on the character.`;
  return lines(title, prompt, pictureNegative, [
    `Size: ${media.image.size} x ${media.image.size} pixels, square, PNG`,
    `Background: ${background}`,
    ...(colour === "green" ? ["If your tool cannot make exactly #00FF00, any flat single green is fine."] : []),
    "Transparency: If your tool can make a transparent PNG, ask for a transparent background instead and say so when you upload it. Otherwise keep the flat background.",
    `Pose and framing: one character, full body, centred, about ${media.image.margin_percent} percent empty margin on every side, standing relaxed, facing the viewer, mouth closed, arms down, simple clean illustration with flat colours.`,
    "Make several and pick one. Bring it back with Upload a picture in the Look tab (you will be asked to confirm you made it or have the right to use it).",
  ]);
}

export function clipPromptPack(companion: Companion, look: Look, stateId: string, motionOverride?: string): CompanionPromptPack {
  const state = media.states.find((row) => row.id === stateId);
  if (!state) throw new Error("Unknown companion state.");
  const displayName = companion.display_name;
  const label = state.id.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
  const title = `Character clip: ${label} for ${displayName}`;
  const key = look.sheet?.key ?? look.key;
  const colour = keyName(key);
  const motion = motionOverride?.trim() || state.motion;
  const cardText = look.sheet?.card?.text ?? companion.look_prompt ?? "";
  const prompt = takePrompt({ text: cardText }, motion, colour);
  const start = look.sheet?.state === "approved" && look.sheet.card
    ? `the approved starting picture of ${displayName} as the first frame (attach it as the image to animate). Do not change the character.`
    : `the starting picture you pick in the Look tab for ${displayName} as the first frame (attach it as the image to animate). Do not change the character.`;
  const megabytes = media.upload_video.max_bytes / (1024 * 1024);
  const kind = state.kind === "loop" ? "loops" : "plays once";
  const colourWord = colour;
  const tail = [
    `Plays when: ${state.driven_by}`,
    `Kind: ${kind}`,
    `Start from: ${start}`,
  ];
  return {
    title,
    prompt,
    negative_prompt: TAKE_NEGATIVE_PROMPT,
    text: [title, ...tail, `Prompt: ${prompt}`, `Activity: ${motion}`, `Negative prompt: ${TAKE_NEGATIVE_PROMPT}`,
    `Duration and size: ${media.generate.seconds} seconds (${media.generate.frames} frames at ${media.generate.fps} fps), ${media.generate.width} x ${media.generate.height} pixels (square), no sound.`,
    "Camera: locked, no zoom, no pan, no cuts; the character stays centred and the same size.",
    `Background: the same flat solid ${colourWord} as the start picture, no shadow, no ground. Home removes it afterwards.`,
    "Transparency: If your tool can export a transparent video (WebM with alpha), do that and tick \"This clip has a transparent background\" when you upload it. Otherwise keep the flat background.",
    state.kind === "loop" ? "Loop: The last frame should flow into the first so it can repeat without a visible jump." : "Loop: It starts and ends in the same relaxed pose.",
    `Bring it back with Upload a clip on the ${label} card in the States tab: MP4, MOV or WebM, at most ${media.upload_video.max_seconds} seconds and ${megabytes} MB. Home cuts out the background, fits the loop and checks the colours.`,
    ].join("\n"),
  };
}
