import { HeroSlide, type HeroSlide as HeroSlideRecord } from "@maipai/spec/gen/ts/hero-slide";
import slides from "./hero.json";
import canonicalCopy from "../../../../.github/brand/COPY.md?raw";

function copyTextFor(key: string): string {
  const marker = new RegExp(`^\\*\\*${key} \\([^\\n]+\\):\\*\\*\\s*$`, "m");
  const match = marker.exec(canonicalCopy);
  if (!match) throw new Error(`Hero slide copy_ref '${key}' was not found in brand/COPY.md`);
  const remaining = canonicalCopy.slice(match.index + match[0].length).trimStart();
  const text = remaining.split(/\n(?=\*\*|#{1,6}\s)/, 1)[0]?.replace(/\s*\n\s*/g, " ").trim();
  if (!text) throw new Error(`Hero slide copy_ref '${key}' has no copy in brand/COPY.md`);
  return text;
}

const parsedSlides = slides.map((slide) => {
  const parsed = HeroSlide.parse(slide);
  return { ...parsed, text: parsed.copy_ref ? copyTextFor(parsed.copy_ref) : parsed.text };
});

export type HeroSlideView = HeroSlideRecord & { text: string };

export function heroSlides(robotPackageAvailable = false): HeroSlideView[] {
  return parsedSlides
    .filter((slide) => slide.id !== "hero.bot" || robotPackageAvailable)
    .sort((left, right) => left.order - right.order) as HeroSlideView[];
}
