import type { ConnectorInstance } from "@/lib/connectors/instances";
import type { ConnectorDeps } from "@/lib/mcp/connector";

export const GITEA_TOOLS = ["list_my_repos", "search_repos", "get_file_content", "list_issues", "get_issue_by_index", "list_pull_requests", "get_pull_request_by_index", "list_repo_commits", "list_branches", "list_releases"] as const;
export const giteaInstance = (instance: string, label: string, address = "http://10.0.0.20:3000"): ConnectorInstance => ({ type: "gitea", instance, label, address, credentialRef: "gitea.access_token", options: {}, virtual: false });

export function fakeMcp(tools: Array<{ name: string; description?: string; inputSchema?: unknown }>, reply = "repo list") {
  return {
    deps: { createClient: () => ({
      connect: async () => {}, close: async () => {},
      listTools: async () => ({ tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as { type: "object" } })) }),
      callTool: async () => ({ content: [{ type: "text", text: reply }] }),
    } as never) } satisfies ConnectorDeps,
  };
}

export const toolDefs = GITEA_TOOLS.map((name) => ({ name, description: `Read ${name}`, inputSchema: { type: "object", properties: {}, additionalProperties: false } }));
