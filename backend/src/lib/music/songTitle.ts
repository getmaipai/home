// AUDIO-TITLE-01: a new song with no title gets a real one from its lyrics or description,
// so its card, library row and cover prompt never say "Song". Pure and deterministic.

const SECTION_TAG = /^\s*\[[^\]]*\]\s*$/;
const TRAILING_PUNCT = /[.,!?;:]+$/;
const EDGE_QUOTES = /^['"`\u2018\u2019\u201C\u201D]+|['"`\u2018\u2019\u201C\u201D]+$/g;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function titleCase(text: string): string {
  return words(text)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Clean a candidate title: Title Case, strip edge quotes and trailing punctuation, collapse spaces, cut to 60 characters. */
function polish(text: string): string {
  let out = titleCase(text);
  out = out.replace(EDGE_QUOTES, "");
  out = out.replace(TRAILING_PUNCT, "");
  out = words(out).join(" ");
  out = out.replace(/[\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return out.slice(0, 60).trim();
}

export function fallbackSongTitle(request: { description: string; lyrics?: string; instrumental?: boolean; title?: string }): string {
  let candidate = "";
  // a. A title that was given wins, trimmed.
  const given = request.title?.trim();
  if (given) {
    candidate = given;
  } else {
    // b. The first sung line that is not blank and not a section tag, first 6 words.
    const line = (request.lyrics ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== "" && !SECTION_TAG.test(l));
    if (!request.instrumental && line) {
      candidate = words(line).slice(0, 6).join(" ");
    } else {
      // c. Otherwise the description: the subject after about/called/named, else the description minus a leading article.
      const description = (request.description ?? "").trim();
      const subject = /\b(?:about|called|named)\b\s+([^\s]+(?:\s+[^\s]+){0,4})/i.exec(description);
      if (subject?.[1]) {
        candidate = subject[1];
      } else {
        const rest = words(description);
        if (/^(a|an|the|some)$/i.test(rest[0] ?? "")) rest.shift();
        candidate = rest.slice(0, 4).join(" ");
      }
    }
  }
  // e. Never empty.
  return polish(candidate) || "New Song";
}
