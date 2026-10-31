import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type ColorFinding = { file: string; line: number; pattern: string; excerpt: string };
type AllowEntry = { file: string; pattern: string; reason: string };

const TOKEN_DEFINITION_FILES = new Set(["shell/tokens.css", "shell/pages/settings/settingsTokens.css"]);
const ALLOWLIST_PATH = join(import.meta.dir, "color-lint-allowlist.json");
const ALLOWLIST = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as AllowEntry[];
const LITERAL_COLOR = /(?<![\w-])#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\s*\(/gi;
const NAMED_COLOR = /\b(?:black|white|red|navy|blue|green|yellow|purple|orange|pink|gray|grey|maroon|lime|aqua|teal|fuchsia|olive|silver)\b/gi;
const PALETTE_CLASS = /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-(?:blue|slate|zinc|gray|stone|neutral|red|green|emerald|lime|yellow|amber|orange|pink|purple|violet|indigo|cyan|teal|sky|rose)-\d{2,3}\b|\b(?:bg|text|border|ring)-\[#(?:[\da-f]{3,8})\]/gi;
const ARBITRARY_TOKEN_CLASS = /\b(?:text|border)-\[var\(--(?!hue-)[^)]+\)\]/g;

function filesUnder(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(root, path);
    return /\.(?:css|tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
}

function stripComments(line: string): string {
  return line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
}
function isClassColor(line: string, index: number): boolean {
  return /(?:className|class)\s*=|className\s*:\s*|\bcn\s*\(/.test(line) && /(?:^|\s)[\w:[\]#./%-]+$/.test(line.slice(0, index + 1));
}
function allowed(file: string, pattern: string): boolean {
  return ALLOWLIST.some((entry) => entry.file === file && entry.pattern === pattern && entry.reason.trim().length > 0);
}

export function colorFindings(srcRoot: string, fixtures?: Record<string, string>): ColorFinding[] {
  const sources = fixtures ?? Object.fromEntries(filesUnder(srcRoot).map((path) => [relative(srcRoot, path), readFileSync(path, "utf8")]));
  const findings: ColorFinding[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (!fixtures && (TOKEN_DEFINITION_FILES.has(file) || /\.test\.[jt]sx?$/.test(file))) continue;
    source.split(/\r?\n/).forEach((raw, index) => {
      const line = stripComments(raw);
      const matches: Array<{ pattern: string; at: number }> = [];
      for (const regex of [LITERAL_COLOR, PALETTE_CLASS, ARBITRARY_TOKEN_CLASS]) {
        regex.lastIndex = 0;
        for (const match of line.matchAll(regex)) {
          if (regex === LITERAL_COLOR && match[0].startsWith("#") && (/[-\w]\[$/.test(line.slice(0, match.index)) || /(?:#\d|\w)\s*$/.test(line.slice(0, match.index)))) continue;
          matches.push({ pattern: match[0], at: match.index ?? 0 });
        }
      }
      NAMED_COLOR.lastIndex = 0;
      for (const match of line.matchAll(NAMED_COLOR)) {
        const at = match.index ?? 0;
        const prefix = line.slice(Math.max(0, at - 32), at);
        const after = line.slice(at + match[0].length, at + match[0].length + 12);
        if (prefix.endsWith("--hue-") || prefix.endsWith("--profile-accent-")) continue;
        if (/(?:^|[;{])\s*(?:color|background|border|outline|fill|stroke)\s*:\s*$/i.test(prefix) || /(?:bg|text|border|ring|fill|stroke|from|via|to)-$/.test(prefix.slice(prefix.lastIndexOf(" ") + 1)) || /-\[color:\s*(?:black|white|red|navy|blue|green|yellow|purple|orange|pink|gray|grey|maroon|lime|aqua|teal|fuchsia|olive|silver)/i.test(prefix) || (/\b(?:className|class)\s*=/.test(line) && /(?:^|\s)(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-/.test(prefix.slice(prefix.lastIndexOf(" ") + 1)))) {
          if (!/^[-\w]/.test(after) && !/^\(/.test(after)) matches.push({ pattern: match[0], at });
        }
      }
      for (const match of matches) {
        if (isClassColor(line, match.at) && /(?:bg|text|border|ring)-\[#/i.test(line.slice(Math.max(0, match.at - 8), match.at + match.pattern.length))) {
          // The arbitrary utility itself is already the finding.
        }
        if (!allowed(file, match.pattern)) findings.push({ file, line: index + 1, pattern: match.pattern, excerpt: line.trim() });
      }
    });
  }
  return findings;
}
