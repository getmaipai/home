import { describe, expect, test } from "bun:test";
import { heroSlides } from "./heroSlides";

describe("hero slides", () => {
  test("declares the seven ordered slides once and resolves canonical copy refs", () => {
    const slides = heroSlides(true);
    expect(slides.map((slide) => slide.id)).toEqual([
      "hero.home", "hero.privacy", "hero.try", "hero.kids", "hero.apps", "hero.offline", "hero.bot",
    ]);
    expect(slides[0]?.text).toContain("Your own AI, music, videos");
    expect(slides[4]?.text).toContain("New features and abilities");
    expect(slides[6]?.text).toContain("A robot friend");
  });

  test("omits the bot slide until a robot package is available", () => {
    expect(heroSlides().map((slide) => slide.id)).not.toContain("hero.bot");
    expect(heroSlides(true).map((slide) => slide.id)).toContain("hero.bot");
  });
});
