// MEDIA-LIB-01: film names (`Title (Year).ext`) and the NFO beside one. An NFO is only ever read, never written.
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeEntities, plainText, spaced, stripExtension } from "./text";

export interface FilmName {
  title: string;
  year: number | null;
}

const PAREN_YEAR = /^(.*?)\s*[([]((?:19|20)\d{2})[)\]]/;
const DOTTED_YEAR = /^(.*?)[.\s_]((?:19|20)\d{2})(?=[.\s_]|$)/;

export function filmNameHasYear(rel: string): boolean {
  const base = stripExtension(rel.split("/").pop() ?? "");
  return PAREN_YEAR.test(base) || DOTTED_YEAR.test(base);
}

/** `Title (Year).ext`, `Title [Year].ext` and `Title.Year.1080p.ext`; with no year the cleaned file name is the title. */
export function parseFilmName(rel: string): FilmName {
  const parts = rel.split("/");
  const base = stripExtension(parts[parts.length - 1] ?? "");
  let title = base;
  let year: number | null = null;
  const paren = PAREN_YEAR.exec(base);
  const dotted = paren ? null : DOTTED_YEAR.exec(base);
  const hit = paren ?? dotted;
  if (hit) {
    title = hit[1] ?? "";
    year = Number(hit[2]);
  }
  title = spaced(title.replace(/\s*[\[(]\d{3,4}p[\])].*$/i, ""));
  if (!title && parts.length >= 2) title = spaced((parts[parts.length - 2] ?? "").replace(PAREN_YEAR, "$1"));
  return { title: title || spaced(base), year };
}

export interface Nfo {
  title: string | null;
  year: number | null;
  plot: string | null;
  genre: string | null;
  runtimeS: number | null;
}

const NFO_MAX_BYTES = 256 * 1024;

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? match[1]! : null;
}

export function parseNfo(xml: string): Nfo {
  const title = tag(xml, "title");
  const year = Number(plainText(tag(xml, "year") ?? "", 8));
  const plot = tag(xml, "plot") ?? tag(xml, "outline");
  const genre = tag(xml, "genre");
  const runtime = Number(plainText(tag(xml, "runtime") ?? "", 8));
  return {
    title: title ? decodeEntities(title).trim() || null : null,
    year: Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : null,
    plot: plot ? plainText(plot, 2000) || null : null,
    genre: genre ? plainText(genre, 100) || null : null,
    runtimeS: Number.isFinite(runtime) && runtime > 0 ? Math.round(runtime * 60) : null,
  };
}

/** The NFO next to a film file (`<name>.nfo`, else `movie.nfo` in its folder), or null. Read-only. */
export function readNfoFor(absFile: string): Nfo | null {
  const candidates = [`${stripExtension(absFile)}.nfo`, join(dirname(absFile), "movie.nfo")];
  for (const path of candidates) {
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > NFO_MAX_BYTES) continue;
      return parseNfo(readFileSync(path, "utf8"));
    } catch {
      // no NFO here
    }
  }
  return null;
}
