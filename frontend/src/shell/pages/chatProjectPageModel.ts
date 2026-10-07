import type { ConversationSummary, Roster } from "@/lib/api";

export function projectConversationRows(rows: ConversationSummary[], folderId: string): ConversationSummary[] {
  return rows.filter((row) => row.surface === "chat" && row.folder_id === folderId && !row.archived)
    .sort((a, b) => (b.last_turn_at ?? b.created_at).localeCompare(a.last_turn_at ?? a.created_at));
}

export function projectSourcesVisible(role: Roster["role"], projectFilesEnabled = false): boolean {
  return role !== "child" || projectFilesEnabled;
}
