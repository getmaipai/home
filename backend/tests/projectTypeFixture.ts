import { registerProjectType } from "@/lib/projects/projectTypes";

/** PROJECT-TOOL-REFUSAL-01: start_project is offered only while a project type is registered; tests that count the offered set register this one. */
export function registerFixtureProjectType(): void {
  registerProjectType({
    id: "fixture-project",
    title: "a fixture project",
    description: "A project type for tests that need start_project offered.",
    minRole: "child",
    consequential: false,
    paramsSchema: { type: "object", properties: {}, additionalProperties: false },
    buildPlan: () => ({ steps: [] }),
  } as unknown as Parameters<typeof registerProjectType>[0]);
}
