// PROJECT-RUN-01: the `assemble` step's own registry - a deterministic
// function a package ships, named by `PlanStep.params.assembler`, no
// model, no network (the design record's own words). `markdown-concat`
// is permanent host machinery, not a stand-in waiting to be replaced
// (PROJECT-PKGTYPE-01): it's the generic "join these text artifacts in
// order" assembler every plain-text project type can reference by name
// in its own plan.json, the way the real bundled `bedtime-storybook`
// package (`backend/packages/bedtime-storybook/plan.json`) already
// does - another real catalog package is free to name it too, or
// register its own assembler for a shape this one doesn't cover (a
// real coloring book's page layout, say).
export interface AssemblerInput {
  stepId: string;
  text: string;
}

export type AssemblerFn = (inputs: AssemblerInput[]) => string;

const registry = new Map<string, AssemblerFn>();

export function registerAssembler(name: string, fn: AssemblerFn): void {
  registry.set(name, fn);
}

export function getAssembler(name: string): AssemblerFn | undefined {
  return registry.get(name);
}

registerAssembler("markdown-concat", (inputs) => inputs.map((input) => input.text).join("\n\n"));
