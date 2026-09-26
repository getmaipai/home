// PROJECT-RUN-01: the `assemble` step's own registry - a deterministic
// function a package ships, named by `PlanStep.params.assembler`, no
// model, no network (the design record's own words). One built-in
// entry, markdown-concat, exists so the runner and its tests have a real
// assembler to prove the mechanism with before any package ships one of
// its own (PROJECT-PACK-01).
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
