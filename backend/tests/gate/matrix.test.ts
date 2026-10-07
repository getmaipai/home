import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import permissions from "@maipai/spec/vocab/permissions.json" with { type: "json" };
import grantActions from "@maipai/spec/vocab/grant-actions.json" with { type: "json" };
import { decide, registeredCapabilities } from "@/lib/gate/decide";

type Band = "child" | "teen" | "adult";
type Provenance = "person" | "untrusted";
type ContextName = "normal" | "temporary" | "crisis";
type MatrixRow = { id: string; capability: string; parameters?: Record<string, string>; band: Band; provenance: Provenance; context: ContextName; result: string };

const registry = [...permissions.permissions, ...grantActions.actions] as Array<{ id: string; policy?: { by_parameter?: Record<string, unknown> } }>;
const golden = JSON.parse(readFileSync(new URL("./capability-matrix.golden.json", import.meta.url), "utf8")) as MatrixRow[];
const bands: Band[] = ["child", "teen", "adult"];
const provenances: Provenance[] = ["person", "untrusted"];
const contexts: ContextName[] = ["normal", "temporary", "crisis"];

function fixtures(id: string): Array<{ capability: string; parameters?: Record<string, string> }> {
  const row = registry.find((candidate) => candidate.id === id);
  let values: string[];
  if (!id.includes("<")) values = [id];
  else if (id === "net:<host>") values = ["net:api.open-meteo.com"];
  else if (id === "actions:<kind>") values = ["actions:lights"];
  else if (id === "home:<domain>") values = ["home:unknown", ...Object.keys(row?.policy?.by_parameter ?? {}).map((value) => `home:${value}`)];
  else if (id === "integration:<id>") values = ["integration:searxng"];
  else if (id === "files:<path>") values = ["files:/tmp/example"];
  else if (id === "use:<package>") values = ["use:storybook"];
  else values = [id.replace(/<[^>]+>/g, "fixture")];
  const parameterVariants = Object.keys(row?.policy?.by_parameter ?? {});
  const results: Array<{ capability: string; parameters?: Record<string, string> }> = values.map((capability) => ({ capability }));
  for (const value of parameterVariants) results.push({ capability: id, parameters: { [id]: value } });
  return results;
}

function outcome(band: Band, fixture: { capability: string; parameters?: Record<string, string> }, provenance: Provenance, context: ContextName): string {
  const result = decide({
    who: { personId: "matrix", role: band, band },
    what: { capabilities: [fixture.capability], parameters: fixture.parameters },
    context: { provenance, ...(context === "normal" ? {} : { [context]: true }) },
  });
  return result.kind === "deny" ? `${result.kind}:${result.reason}` : result.kind === "allow_with_limits" ? `${result.kind}:${result.limits.join(",")}` : result.kind;
}

describe("GATE-01 capability policy matrix", () => {
  test("every registry capability, band, provenance, and context matches the committed matrix", () => {
    const generated: MatrixRow[] = [];
    for (const id of registeredCapabilities()) {
      for (const fixture of fixtures(id)) {
        for (const band of bands) for (const provenance of provenances) for (const context of contexts) {
          generated.push({ id, ...fixture, band, provenance, context, result: outcome(band, fixture, provenance, context) });
        }
      }
    }
    expect(generated).toEqual(golden);
  });
});
