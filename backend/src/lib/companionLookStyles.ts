/** The art styles a household can pick for generated companion pictures; the one list, served to the Look tab with the look. */
export const LOOK_STYLES = [
  { id: "cartoon", label: "Cartoon", phrase: "Simple clean cartoon illustration, flat colours." },
  { id: "anime", label: "Anime", phrase: "Anime style illustration, clean line art, cel shading, expressive eyes." },
  { id: "photorealistic", label: "Photorealistic", phrase: "Photorealistic, lifelike detail and natural lighting, a realistic photograph of the character." },
  { id: "3d", label: "3D animated", phrase: "3D animated movie style, soft studio lighting, smooth rounded shapes." },
  { id: "pixel", label: "Pixel art", phrase: "Pixel art, crisp square pixels, limited colour palette." },
  { id: "watercolor", label: "Watercolour storybook", phrase: "Watercolour storybook illustration, soft painted textures, gentle colours." },
] as const;

export type LookStyleId = (typeof LOOK_STYLES)[number]["id"];
export const LOOK_STYLE_IDS = LOOK_STYLES.map((style) => style.id) as [LookStyleId, ...LookStyleId[]];
export const DEFAULT_LOOK_STYLE: LookStyleId = "cartoon";
export function lookStylePhrase(style: LookStyleId | undefined): string { return (LOOK_STYLES.find((item) => item.id === style) ?? LOOK_STYLES[0]).phrase; }
