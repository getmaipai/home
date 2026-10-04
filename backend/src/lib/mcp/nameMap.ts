// H2 (tools-ecosystem-design-2026-10-03.md section 4): namespaced tool ids,
// `server__tool`, within the 64-character limit model APIs apply to a tool
// name. The map is the reversal: a name that had to be cut or cleaned gets a
// short hash of the original, and the map remembers which original it was.
import { createHash } from "node:crypto";

export const MAX_TOOL_NAME = 64;

export interface NameMap {
  toWire(server: string, tool: string): string;
  fromWire(wire: string): { server: string; tool: string } | undefined;
}

const SEP = "__";

function hashOf(server: string, tool: string, length: number): string {
  return createHash("sha256").update(`${server}\u0000${tool}`).digest("hex").slice(0, length);
}

export function createNameMap(): NameMap {
  const byWire = new Map<string, { server: string; tool: string }>();
  const byPair = new Map<string, string>();

  return {
    toWire(server, tool) {
      const pairKey = `${server}\u0000${tool}`;
      const known = byPair.get(pairKey);
      if (known !== undefined) return known;
      const plain = `${server}${SEP}${tool}`;
      const cleaned = plain.replace(/[^A-Za-z0-9_-]/g, "_");
      let wire = cleaned;
      if (cleaned !== plain || cleaned.length > MAX_TOOL_NAME || byWire.has(cleaned)) {
        for (let len = 8; ; len += 4) {
          const suffix = `_${hashOf(server, tool, len)}`;
          wire = cleaned.slice(0, MAX_TOOL_NAME - suffix.length) + suffix;
          if (!byWire.has(wire) || len >= 64) break;
        }
      }
      byWire.set(wire, { server, tool });
      byPair.set(pairKey, wire);
      return wire;
    },
    fromWire(wire) {
      return byWire.get(wire);
    },
  };
}
