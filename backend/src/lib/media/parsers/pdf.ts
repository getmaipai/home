// MEDIA-LIB-01: a PDF's title and page count without a PDF library. Best effort: a file whose page tree sits in a compressed
// object stream has no readable count (pages stays null) and keeps its file name as the title.
import { statSync } from "node:fs";
import { readFileSync } from "node:fs";

export interface PdfMeta {
  title: string | null;
  author: string | null;
  pages: number | null;
}

const MAX_BYTES = 32 * 1024 * 1024;

function decodePdfString(raw: string): string | null {
  let text = raw;
  if (raw.startsWith("<") && raw.endsWith(">")) {
    const hex = raw.slice(1, -1).replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    text = bytes[0] === 0xfe && bytes[1] === 0xff ? new TextDecoder("utf-16be").decode(bytes.subarray(2)) : new TextDecoder("latin1").decode(bytes);
  } else {
    text = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, code: string) => {
      if (/^[0-7]+$/.test(code)) return String.fromCharCode(Number.parseInt(code, 8));
      return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[code] ?? code;
    });
    if (text.startsWith("\xfe\xff")) text = new TextDecoder("utf-16be").decode(Uint8Array.from(text.slice(2), (c) => c.charCodeAt(0)));
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 300) : null;
}

function infoString(source: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9a-fA-F\\s]*>)`).exec(source);
  return match ? decodePdfString(match[1]!) : null;
}

export function parsePdf(source: string): PdfMeta {
  let pages: number | null = null;
  for (const match of source.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) {
    const n = Number(match[1] ?? match[2]);
    if (Number.isFinite(n)) pages = Math.max(pages ?? 0, n);
  }
  if (pages === null) {
    const leaves = source.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
    pages = leaves > 0 ? leaves : null;
  }
  return { title: infoString(source, "Title"), author: infoString(source, "Author"), pages };
}

export function readPdfMeta(absPath: string): PdfMeta | null {
  try {
    if (statSync(absPath).size > MAX_BYTES) return { title: null, author: null, pages: null };
    const source = new TextDecoder("latin1").decode(readFileSync(absPath));
    if (!source.startsWith("%PDF-")) return null;
    return parsePdf(source);
  } catch {
    return null;
  }
}
