// MINOR-SEARCH-01m: a child's answer carries no outbound link in any closed format, in the stream or at rest.
import { describe, expect, test } from "bun:test";
import { stripLinksForChild, sourcesForChild } from "@/lib/childLinks";
import { StreamGate } from "@/lib/turnMachine/nodes/outputGate";
import type { PersonRow } from "@/types";
import type { Source } from "@maipai/spec/gen/ts/source.js";

const ACTOR = { id: "person-juniper", displayName: "Juniper", role: "owner", birthdate: null } as unknown as PersonRow;
const TEXT = "Frogs live near ponds [1]. Read [the frog page](https://example.com/frogs?x=1) or see <https://example.com/a> and https://example.com/b today.";

function run(band: "adult" | "teen" | "child"): { text: string; released: string } {
  const released: string[] = [];
  const gate = new StreamGate(band, ACTOR, "turn-child-links", (t) => released.push(t), () => {}, () => {}, { grain: band === "adult" ? "arrival" : "sentence" });
  for (const word of TEXT.split(/(?<= )/)) gate.push(word);
  gate.finish();
  return { text: gate.result().text, released: released.join("") };
}

describe("stripLinksForChild", () => {
  test("a markdown link keeps its words, an autolink and a bare address go, the [n] marker stays", () => {
    expect(stripLinksForChild(TEXT)).toBe("Frogs live near ponds [1]. Read the frog page or see and today.");
  });
  test("a label split by a sentence break leaves no address in the later span", () => {
    expect(stripLinksForChild("Frog](https://example.com/frog) is green.")).toBe("Frog] is green.");
  });
  test("an address with parentheses and an image link are handled", () => {
    expect(stripLinksForChild("See [Frog](https://en.wikipedia.org/wiki/Frog_(animal)) and ![pond](https://example.com/p.png).")).toBe("See Frog and pond.");
  });
  test("indentation and spacing elsewhere in the text are left alone", () => {
    expect(stripLinksForChild("- one\n    - two https://example.com/a\n\n  code  here")).toBe("- one\n    - two\n\n  code  here");
  });
  test("text with no address is returned as it came", () => {
    expect(stripLinksForChild("Frogs [1] like water.")).toBe("Frogs [1] like water.");
  });
});

describe("the released stream", () => {
  test("a child's stored and released text hold no address, and stored equals released", () => {
    const child = run("child");
    expect(child.text).not.toContain("http");
    expect(child.text).toContain("the frog page");
    expect(child.text).toContain("[1]");
    expect(child.text).toBe(child.released);
  });
  test("a teen and an adult keep every address", () => {
    expect(run("teen").text).toContain("https://example.com/frogs?x=1");
    expect(run("adult").text).toContain("https://example.com/frogs?x=1");
  });
});

describe("sourcesForChild", () => {
  const web = { id: "src-abcdef12", kind: "web", title: "Frogs", url: "https://www.example.com/frogs/pond?x=1", site: "example.com" } as unknown as Source;
  const library = { id: "src-abcdef34", kind: "reference", title: "Frog", url: "https://en.wikipedia.org/wiki/Frog", local_path: "/api/library/frog" } as unknown as Source;
  test("a web source shrinks to the site's front page and keeps its title and site", () => {
    const [out] = sourcesForChild([web]);
    expect(out!.url).toBe("https://www.example.com/");
    expect(out!.title).toBe("Frogs");
    expect(out!.site).toBe("example.com");
  });
  test("a library page keeps its in-home path but not the public page address", () => {
    const [out] = sourcesForChild([library]);
    expect(out!.url).toBe("https://en.wikipedia.org/");
    expect((out as { local_path?: string }).local_path).toBe("/api/library/frog");
  });
});
