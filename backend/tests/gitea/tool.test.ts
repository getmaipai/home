import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { integrations, toolAudit } from "@/db/schema";
import { resetDb } from "../reset-db";
import { fakeMcp, giteaInstance, GITEA_TOOLS, toolDefs } from "./helpers";
import { createGiteaConnector, giteaAllowed, GITEA_TOOL_ALLOWLIST, giteaToolSpec, runGiteaTool, __resetGiteaConnectorsForTests } from "@/lib/gitea/tool";
import { privacyConnections } from "@/lib/privacy";
import { createBenchPeople } from "../../scripts/bench/conversationRunner";
import { getRegistry } from "@/lib/settingsRegistry";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";

beforeEach(() => { resetDb(); __resetGiteaConnectorsForTests(); });

describe("Gitea connector allowlist and pins", () => {
  test("is exactly the read-only set with no mutation tools", () => {
    expect(GITEA_TOOL_ALLOWLIST).toEqual([...GITEA_TOOLS]);
    expect(GITEA_TOOL_ALLOWLIST.some((name) => /^(create_|edit_|delete_|merge_|add_|update_|fork_|remove_)/.test(name))).toBe(false);
  });
  test("calls an allowed tool and refuses a tool outside the allowlist", async () => {
    const { deps } = fakeMcp([...toolDefs, { name: "create_repo", inputSchema: { type: "object" } }]);
    const c = createGiteaConnector(giteaInstance("main", "Main"), { command: "/usr/local/bin/gitea-mcp", token: "secret" }, deps);
    const listed = await c.listTools();
    expect(listed.map((tool) => tool.id)).toHaveLength(GITEA_TOOLS.length);
    expect((await c.callTool("gitea__list_my_repos", {}))).toMatchObject({ ok: true, text: "repo list" });
    expect(await c.callTool("gitea__create_repo", {})).toEqual({ ok: false, kind: "refused" });
  });
  test("pin mismatch disables the call", async () => {
    const { deps } = fakeMcp(toolDefs);
    const c = createGiteaConnector(giteaInstance("main", "Main"), { command: "/usr/local/bin/gitea-mcp", token: "secret", pins: { list_my_repos: "wrong" } }, deps);
    expect((await c.listTools()).find((tool) => tool.id === "gitea__list_my_repos")?.disabled).toBe(true);
    expect(await c.callTool("gitea__list_my_repos", {})).toEqual({ ok: false, kind: "refused" });
  });
  test("the Gitea tool calls its cached connector and redacts a token echoed by the server", async () => {
    const token = "never-transcribe-this";
    const { deps } = fakeMcp(toolDefs, `repo output ${token}`);
    const outcome = await runGiteaTool({ actor: { id: "adult", role: "owner" }, band: "adult", args: { tool: "list_my_repos" }, callId: "c", deps: {
      instances: () => [giteaInstance("main", "Main")], connectorDeps: deps,
      readSetting: (key) => key === "gitea.mcp_command" ? "/usr/local/bin/gitea-mcp" : key === "gitea.access_token" ? token : undefined,
      audit: () => {},
    } });
    expect(outcome.result?.reply?.text).toContain("repo output [redacted]");
    expect(outcome.result?.reply?.text).not.toContain(token);
  });
});

describe("Gitea tool boundary", () => {
  test("strict schema refuses a model supplied URL", async () => {
    const schema = (giteaToolSpec([giteaInstance("main", "Main")]).args as { properties: Record<string, unknown>; additionalProperties: boolean });
    expect(schema.additionalProperties).toBe(false);
    const d = { instances: () => [giteaInstance("main", "Main")], connect: async () => ({ ok: true as const, text: "x", truncated: false }), audit: () => {} };
    expect((await runGiteaTool({ actor: { id: "adult", role: "owner" }, band: "adult", args: { tool: "list_my_repos", url: "http://evil" }, callId: "c", deps: d })).failureKind).toBe("bad_arguments");
  });
  test("wrong port, public address and hostnames are refused", () => {
    for (const address of ["http://10.0.0.20:3001", "http://203.0.113.9:3000", "http://192.0.2.10:3000", "http://gitea.local:3000"]) {
      expect(() => createGiteaConnector(giteaInstance("main", "Main", address), { command: "/usr/local/bin/gitea-mcp", token: "secret" })).toThrow("refused");
    }
  });
  test("failure maps to kind only and audit row carries no names", async () => {
    const stamp = "2026-11-08T00:00:00.000Z";
    db.insert(integrations).values({ id: "gitea-main", type: "gitea", instance: "main", label: "Private Forge", address: "http://10.0.0.20:3000", credentialRef: "gitea.access_token", options: "{}", enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
    const { owner } = createBenchPeople();
    const outcome = await runGiteaTool({ actor: { id: owner.id, role: "owner" }, band: "adult", args: { tool: "list_my_repos", instance: "main" }, callId: "c", deps: { instances: () => [giteaInstance("main", "Private Forge")], connect: async () => ({ ok: false as const, kind: "timeout" }), readSetting: () => "secret" } });
    expect(outcome.userMessage).toBe("Gitea did not answer (timed out).");
    const row = db.select().from(toolAudit).get();
    expect(row?.action).toBe("list_my_repos");
    const audit = JSON.stringify(row);
    for (const secret of ["Private Forge", "main", "owner/repo", "secret", "gitea.main"]) expect(audit).not.toContain(secret);
  });
});

describe("Gitea offer", () => {
  const written = { surfaceClass: "written", spoken: false, bare: false };
  const adult = { id: "adult", role: "owner" as const };
  test("only an adult on written chat with an enabled instance can use it", () => {
    expect(giteaAllowed({ actor: adult, band: "adult", ...written }, { instances: () => [] })).toBe(false);
    expect(giteaAllowed({ actor: adult, band: "adult", ...written }, { instances: () => [giteaInstance("main", "Main")] })).toBe(true);
    for (const [role, band] of [["child", "child"], ["teen", "teen"], ["guest", "adult"], ["owner", "unknown"]] as const) {
      expect(giteaAllowed({ actor: { role }, band, ...written }, { instances: () => [giteaInstance("main", "Main")] })).toBe(false);
    }
    expect(giteaAllowed({ actor: adult, band: "adult", surfaceClass: "spoken", spoken: true, bare: false }, { instances: () => [giteaInstance("main", "Main")] })).toBe(false);
    expect(giteaAllowed({ actor: adult, band: "adult", surface: "overlay", surfaceClass: "written", spoken: false, bare: false }, { instances: () => [giteaInstance("main", "Main")] })).toBe(false);
  });
  test("the conditional offer and the household setting declarations are registered", () => {
    expect(VIRTUAL_TOOL_REGISTRY.find((tool) => tool.id === "gitea")?.offer).toEqual({ mode: "conditional", gate: "giteaAllowed", bench_row: "gitea-tool", priority: 4 });
    const keys = getRegistry();
    expect(keys.find((key) => key.key === "gitea.mcp_command")?.scope).toBe("household");
    expect(keys.find((key) => key.key === "gitea.mcp_pins")?.scope).toBe("household");
    expect(keys.find((key) => key.key === "gitea.access_token")?.secret).toBe(true);
  });
  test("two instances require explicit selection for ambiguous owner/repo and argument labels appear only for multiple instances", async () => {
    const one = [giteaInstance("main", "Main")];
    expect(JSON.stringify(giteaToolSpec(one).args)).not.toContain("instance");
    const two = [giteaInstance("main", "Main"), giteaInstance("lab", "Lab")];
    expect(JSON.stringify(giteaToolSpec(two).args)).toContain("instance");
    const outcome = await runGiteaTool({ actor: adult, band: "adult", args: { tool: "get_file_content", owner_repo: "owner/repo", path: "README.md" }, callId: "c", deps: { instances: () => two, connect: async () => ({ ok: true as const, text: "file", truncated: false }), audit: () => {} } });
    expect(outcome.userMessage).toContain("Choose an instance: Main or Lab.");
  });
});

test("privacy has one conditional Gitea row and no address", () => {
  expect(privacyConnections().filter((row) => row.id === "platform:gitea")).toHaveLength(0);
  const stamp = "2026-11-08T00:00:00.000Z";
  db.insert(integrations).values({ id: "gitea-main", type: "gitea", instance: "main", label: "Main", address: "http://10.0.0.20:3000", credentialRef: "gitea.access_token", options: "{}", enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
  const rows = privacyConnections().filter((row) => row.id === "platform:gitea");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.destination).toContain("Gitea");
  expect(rows[0]?.what).not.toContain("192.168");
});
