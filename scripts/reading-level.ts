#!/usr/bin/env bun
// docs/STYLE.md's user-tier standard: "Grade 6 to 8 reading level" for
// docs/user/. Strips frontmatter, code fences, and markdown syntax
// (raw markdown punctuation and link syntax otherwise skews syllable/
// sentence counts) before scoring each file with the same Flesch-Kincaid
// Grade Level formula docs/STYLE.md's own standard is named after,
// rather than a hand-rolled syllable counter (CLAUDE.md's "prebuilt
// over hand-built").
import rs from "text-readability";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const USER_DOCS_DIR = join(import.meta.dir, "..", "docs", "user");
const MAX_GRADE = 8;

function stripMarkdown(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, "") // frontmatter
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`[^`]*`/g, "") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    // A bullet item is its own short statement, not a fragment of the
    // next line's sentence (CLAUDE.md: "Bullets are for lists of
    // things, not for prose") - give it a period if it lacks one so a
    // period-counting formula scores it as one sentence, not part of a
    // run-on that swallows the whole list (an earlier version of this
    // script scored a bullet-heavy page at grade 35 this way, an
    // artifact of the tool, not a real reading-level problem).
    .replace(/^([-*]\s+.+?)([.!?:]?)$/gm, (_, item: string, punct: string) => (punct ? `${item}${punct}` : `${item}.`))
    .replace(/[*_>-]/g, "") // emphasis/quote/list markers
    // Removing a leading "- "/"* " marker above leaves a stray space at
    // the start of the line, which breaks text-readability's sentence
    // splitter: it only splits on punctuation + ONE whitespace char
    // immediately followed by a capital letter, so "kept.\n System" (an
    // extra leading space before "System") fails to match and the next
    // bullet gets fused onto the previous "sentence" - the real cause
    // of an earlier version of this script scoring a bullet-heavy page
    // at grade 35 (it wasn't a bullet-vs-prose issue at all).
    .replace(/^[ \t]+/gm, "")
    .trim();
}

function main(): void {
  const files = readdirSync(USER_DOCS_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.log(`No markdown files found in ${USER_DOCS_DIR}.`);
    return;
  }
  let failed = false;
  for (const file of files) {
    const raw = readFileSync(join(USER_DOCS_DIR, file), "utf8");
    const text = stripMarkdown(raw);
    const grade = rs.fleschKincaidGrade(text);
    const status = grade <= MAX_GRADE ? "ok" : "TOO HARD";
    console.log(`${status === "ok" ? " " : "!"} ${file}: grade ${grade.toFixed(1)} (max ${MAX_GRADE}) ${status}`);
    if (grade > MAX_GRADE) failed = true;
  }
  if (failed) {
    console.error(`\nOne or more docs/user/ pages read above a grade ${MAX_GRADE} level. Shorten sentences and simplify wording (docs/STYLE.md: "Grade 6 to 8 reading level, short sentences, second person, contractions").`);
    process.exit(1);
  }
}

main();
