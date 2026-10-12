// MINOR-SEARCH-01m: a child's answer carries no outbound link in any closed format, in the stream or at rest.
import { describe, expect, test } from "bun:test";
import { stripLinksForChild, sourcesForChild, blocksForBand, structuredPartForBand, artifactTextForBand, stripLinksDeep } from "@/lib/childLinks";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
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

// MINOR-SEARCH-01o: the structured parts of a turn.
describe("structured parts for a child", () => {
  const block = {
    id: "blk-abcdef", kind: "image_gallery", schema_version: 1, producer: "sample-package", alt: "Frogs, see https://example.com/frogs",
    provenance: "sample-package result", created_at: "2026-10-08T12:00:00.000Z", hlc: "1791478099338:0:abcdef",
    props: { images: [{ id: "img-1", src: "/api/answer-image/ai_0123456789abcdef0123456789abcdef?v=tile", alt: "A frog", caption: "From [a site](https://example.com/f)", source: { label: "Example", url: "https://example.com/f" } }] },
  };
  test("a block loses its addresses in every string and drops a web url field, and keeps its picture route", () => {
    const [out] = blocksForBand([block], "child") as typeof block[];
    expect(JSON.stringify(out)).not.toContain("http");
    expect(out!.props.images[0]!.caption).toBe("From a site");
    expect((out!.props.images[0]!.source as { label: string; url?: string }).url).toBeUndefined();
    expect(out!.props.images[0]!.source.label).toBe("Example");
    expect(out!.props.images[0]!.src).toBe(block.props.images[0]!.src);
    expect(out!.id).toBe("blk-abcdef");
  });
  test("a teen and an adult get the block as it came", () => {
    expect(blocksForBand([block], "teen")![0]).toBe(block);
    expect(blocksForBand([block], "adult")![0]).toBe(block);
  });
  test("a spec-sheet part loses addresses for a child only", () => {
    const part = { kind: "spec_sheet", tool_id: "almanac-date", title: "Today", rows: [{ label: "More", value: "see https://example.com/day" }] };
    expect(JSON.stringify(structuredPartForBand(part, "child"))).not.toContain("http");
    expect(structuredPartForBand(part, "teen")).toBe(part);
  });
  test("a child's markdown document loses links, code and other bands are left whole", () => {
    const doc = { kind: "markdown", title: "Notes", body: "Read [frogs](https://example.com/f) now." };
    expect(artifactTextForBand(doc, "child").body).toBe("Read frogs now.");
    expect(artifactTextForBand({ ...doc, kind: "code", body: "fetch('https://example.com')" }, "child").body).toContain("https://example.com");
    expect(artifactTextForBand(doc, "adult")).toBe(doc);
  });
  test("filterAnswerBlocks hands a child the stripped block, so the stream and the stored row hold none", () => {
    const sheet = { id: "blk-abcdef", kind: "spec_sheet", schema_version: 1, producer: "sample-package", alt: "Facts", provenance: "x", created_at: "2026-10-08T12:00:00.000Z", hlc: "1791478099338:0:abcdef", props: { title: "Facts", rows: [{ label: "Site", value: "[Frogs](https://example.com/f)" }] } };
    const out = filterAnswerBlocks([sheet], "sample-package", ["spec_sheet"], "child", { displayName: "Juniper" });
    expect(JSON.stringify(out)).not.toContain("http");
    expect(JSON.stringify(filterAnswerBlocks([sheet], "sample-package", ["spec_sheet"], "teen", { displayName: "Juniper" }))).toContain("https://example.com/f");
  });
  test("a block that cannot validate once its address is gone is dropped for a child, never shipped broken", () => {
    const sheet = { id: "blk-abcdef", kind: "spec_sheet", schema_version: 1, producer: "sample-package", alt: "https://example.com/only", provenance: "x", created_at: "2026-10-08T12:00:00.000Z", hlc: "1791478099338:0:abcdef", props: { title: "Facts", rows: [] } };
    expect(filterAnswerBlocks([sheet], "sample-package", ["spec_sheet"], "child", { displayName: "Juniper" })).toEqual([]);
    expect(filterAnswerBlocks([sheet], "sample-package", ["spec_sheet"], "adult", { displayName: "Juniper" })).toHaveLength(1);
  });
  test("a kept key holding an outside address is stripped; a hub path stays", () => {
    expect(stripLinksDeep({ src: "https://cdn.example.com/x.png", full: "/api/answer-image/ai_1?v=full" })).toEqual({ src: "", full: "/api/answer-image/ai_1?v=full" });
  });
});
