import { describe, expect, test } from "bun:test";
import { asksForMedia, asksForSong, claimsMedia, lyricsInsteadOfSong } from "@/lib/mediaClaims";

describe("asksForMedia", () => {
  test.each(["make me a picture of a red fox", "draw a lighthouse at dusk", "can you generate an image of a dragon", "create a short video of a paper boat", "animate this picture", "Please make a clip of a kite", "give me a poster for my bakery", "paint a mountain lake"])("yes: %s", (m) => expect(asksForMedia(m)).toBe(true));
  test.each(["what is a good picture size for a phone", "tell me about foxes", "what's the weather", "how long is a video on tiktok", "I like this picture"])("no: %s", (m) => expect(asksForMedia(m)).toBe(false));
});

describe("asksForMedia: changing a picture they already have (IMGEDIT-01)", () => {
  test.each(["remove the man in the red jacket from this picture", "make the sky clear in my photo", "can you get rid of the car in the photo", "add my sister to the picture", "swap the background of this image for a beach", "this photo is too dark, fix it"])("asks: %s", (m) => expect(asksForMedia(m)).toBe(true));
  test.each(["what time is it", "remove the lid from the pot and stir", "tell me about foxes"])("does not: %s", (m) => expect(asksForMedia(m)).toBe(false));
});

describe("claimsMedia", () => {
  test.each([
    "Your picture is being made. It will show up right below when it is ready.", "Here's your picture of a lighthouse!", "I've made a picture of the fox.", "I'm creating the video now, it takes about two minutes.",
    "The video is ready below.", "Sure, on its way!", "I made a short clip of a lantern floating up.", "Your image has been generated.", "It will appear below in a moment.",
    "The song is ready.", "The song is done.", "The song is finished.", "Here it is.", "The player should appear shortly.",
  ])("claim: %s", (r) => expect(claimsMedia(r)).toBe(true));
  test.each([
    "I can't make videos here.", "I couldn't make that picture. Try again.", "What size would you like, square or wide?", "A lighthouse at dusk usually has a warm light.", "Pictures can only be made in a written chat on your own screen.",
    "You're asking for a lighthouse at dusk.", "I haven't made one yet.",
  ])("no claim: %s", (r) => expect(claimsMedia(r)).toBe(false));
});

describe("asking for a song and answering with lyrics only (live, 2026-10-18)", () => {
  test.each(["write me a song about bananas", "make a song about the sea", "compose a heavy metal song", "sing me a song", "can you write a song for my dad's birthday", "create a modern heavy metal song about bananas"])("asks: %s", (m) => { expect(asksForMedia(m)).toBe(true); expect(asksForSong(m)).toBe(true); });
  test.each(["what is a good song to learn on guitar", "who wrote this song", "make me a picture of a fox"])("not a song request: %s", (m) => expect(asksForSong(m)).toBe(false));
  test("tagged lyrics and a block of short lines are lyrics; prose is not", () => {
    expect(lyricsInsteadOfSong("Here you go.\n\n[Verse]\nYellow moon\n\n[Chorus]\nSing it loud")).toBe(true);
    expect(lyricsInsteadOfSong("**Verse 1**\nA\n**Chorus**\nB")).toBe(true);
    expect(lyricsInsteadOfSong(Array.from({ length: 10 }, (_, i) => `Banana line number ${i} sings`).join("\n"))).toBe(true);
    expect(lyricsInsteadOfSong("Sure. Which style do you want, and should it be quick or full length?")).toBe(false);
  });
});
