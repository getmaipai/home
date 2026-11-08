import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";

export type Segment = { text: string; start: number; end: number; keep: string[] };
type Node = { type?: string; value?: string; url?: string; position?: { start?: { offset?: number }; end?: { offset?: number } }; children?: Node[] };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

function frontmatterRanges(source: string): Array<{ start: number; end: number }> {
  const match = source.match(/^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!match) return [];
  const base = match[1]!.length;
  const body = match[2]!;
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const line of body.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    const text = line[0]!;
    if (!text) continue;
    const value = text.match(/^(title|description):[ \t]*(?:["']?)(.*?)(?:["']?)[ \t]*(?:\r?\n)?$/);
    if (value && value[2]) {
      const leading = text.indexOf(value[2]);
      const raw = value[2].replace(/["']$/, "");
      ranges.push({ start: base + offset + leading, end: base + offset + leading + raw.length });
    }
    offset += text.length;
  }
  return ranges;
}

export function splitMarkdown(source: string): { segments: Segment[] } {
  const tree = parser.parse(source) as unknown as Node;
  const frontmatter = frontmatterRanges(source);
  const segments: Segment[] = [];
  const offset = (node: Node, edge: "start" | "end") => node.position?.[edge]?.offset;
  const hasLettersOutsideProtected = (node: Node): boolean => {
    if (node.type === "text") return /\p{L}/u.test(node.value ?? "");
    if (["inlineCode", "link", "image", "linkReference", "imageReference"].includes(node.type ?? "")) return false;
    return (node.children ?? []).some(hasLettersOutsideProtected);
  };
  const keepFor = (node: Node, start: number, end: number): string[] => {
    const keep: string[] = [];
    const walk = (n: Node): void => {
      const a = offset(n, "start"), b = offset(n, "end");
      if (a === undefined || b === undefined || a < start || b > end) return;
      if (n.type === "link" || n.type === "image" || n.type === "linkReference" || n.type === "imageReference") {
        const raw = source.slice(a, b);
        const tail = raw.match(/\]\([^)]*(?:\([^)]*\)[^)]*)*\)$/)?.[0];
        if (tail) keep.push(tail);
        else if (n.type === "link" || n.type === "image") keep.push(raw);
        return;
      }
      if (n.type === "inlineCode" || n.type === "html" || n.type === "definition") { keep.push(source.slice(a, b)); return; }
      if (n.type === "text" && /^<[^>]+>$/.test(n.value ?? "")) { keep.push(source.slice(a, b)); return; }
      for (const child of n.children ?? []) walk(child);
    };
    walk(node);
    return [...new Set(keep)];
  };
  const visit = (node: Node, inFrontmatter = false): void => {
    if (node.type === "yaml" || node.type === "toml") return;
    if (["paragraph", "heading", "tableCell"].includes(node.type ?? "") && !inFrontmatter) {
      const children = node.children ?? [];
      const start = children.length ? offset(children[0]!, "start") : undefined;
      const end = children.length ? offset(children[children.length - 1]!, "end") : undefined;
      if (start !== undefined && end !== undefined) {
        const raw = source.slice(start, end);
        if (raw && hasLettersOutsideProtected(node) && !frontmatter.some((range) => start >= range.start && end <= range.end)) segments.push({ text: raw, start, end, keep: keepFor(node, start, end) });
      }
      return;
    }
    if (["code", "inlineCode", "html", "definition", "link", "image", "linkReference", "imageReference", "math", "inlineMath"].includes(node.type ?? "")) return;
    for (const child of node.children ?? []) visit(child, inFrontmatter);
  };
  visit(tree);
  for (const range of frontmatter) {
    const text = source.slice(range.start, range.end);
    if (text) segments.push({ text, start: range.start, end: range.end, keep: [] });
  }
  segments.sort((a, b) => a.start - b.start);
  return { segments };
}

export function joinMarkdown(source: string, segments: Segment[], translated: string[]): string {
  if (segments.length !== translated.length) throw new Error("Translation count does not match Markdown segments.");
  let out = "";
  let offset = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.start < offset || segment.end < segment.start || segment.end > source.length) throw new Error("Markdown segment offsets are invalid.");
    out += source.slice(offset, segment.start) + translated[i]!;
    offset = segment.end;
  }
  return out + source.slice(offset);
}
