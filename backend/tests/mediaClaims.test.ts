import { describe, expect, test } from "bun:test";
import { asksForMedia, claimsMedia } from "@/lib/mediaClaims";

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
  ])("claim: %s", (r) => expect(claimsMedia(r)).toBe(true));
  test.each([
    "I can't make videos here.", "I couldn't make that picture. Try again.", "What size would you like, square or wide?", "A lighthouse at dusk usually has a warm light.", "Pictures can only be made in a written chat on your own screen.",
    "You're asking for a lighthouse at dusk.", "I haven't made one yet.",
  ])("no claim: %s", (r) => expect(claimsMedia(r)).toBe(false));
});
