/** The styles available to companion makers and the widest audience their art may reach. */
export const LOOK_STYLES = [
  { id: "cartoon", label: "Cartoon", phrase: "Simple clean cartoon illustration, flat colours.", tile: true, teen: true, cap: "all" },
  { id: "anime", label: "Anime", phrase: "Anime style illustration, clean line art, cel shading, expressive eyes.", tile: true, teen: true, cap: "teen" },
  { id: "photorealistic", label: "Realistic", phrase: "Photorealistic, lifelike detail and natural lighting, a realistic photograph of the character.", tile: true, teen: true, cap: "teen" },
  { id: "3d", label: "3D", phrase: "3D animated movie style, soft studio lighting, smooth rounded shapes.", tile: true, teen: true, cap: "teen" },
  { id: "pixel", label: "Pixel", phrase: "Pixel art, crisp square pixels, limited colour palette.", tile: true, teen: true, cap: "teen" },
  { id: "custom", label: "Custom", phrase: "", tile: true, teen: false, cap: "adult" },
  { id: "watercolor", label: "Watercolor", phrase: "Watercolour storybook illustration, soft painted textures, gentle colours.", tile: false, teen: true, cap: "teen" },
] as const;

export type LookStyleId = (typeof LOOK_STYLES)[number]["id"];
export type LookStyleChoice = LookStyleId | "keep";
export type LookAudienceCap = (typeof LOOK_STYLES)[number]["cap"];
export const LOOK_STYLE_IDS = LOOK_STYLES.map((style) => style.id) as [LookStyleId, ...LookStyleId[]];
export const DEFAULT_LOOK_STYLE: LookStyleId = "cartoon";

export function stylesForBand(band: "child" | "teen" | "adult") {
  if (band === "child") return [];
  return LOOK_STYLES.filter((style) => style.tile && (band === "adult" || style.teen));
}

export function capOfStyle(id: string | undefined): LookAudienceCap | null {
  return LOOK_STYLES.find((style) => style.id === id)?.cap ?? null;
}

export function lookStylePhrase(style: LookStyleChoice | undefined, customText?: string): string {
  if (style === "keep") return "";
  if (style === "custom") return customText?.trim() ?? "";
  return LOOK_STYLES.find((item) => item.id === style)?.phrase ?? LOOK_STYLES[0].phrase;
}
