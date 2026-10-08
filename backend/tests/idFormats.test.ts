import { describe, expect, test } from "bun:test";
import * as ids from "@/lib/id";

const TABLE: ReadonlyArray<readonly [string, string, number]> = [
  ["newPersonId", "person-", 10],
  ["newBiometricPrintId", "print-", 10],
  ["newJobId", "job-", 10],
  ["newConversationTurnId", "turn-", 10],
  ["newReplyFeedbackId", "rf-", 10],
  ["newConversationId", "conv-", 10],
  ["newChatFolderId", "folder-", 10],
  ["newClonedVoiceId", "voice-", 16],
  ["newCommandId", "cmd-", 10],
  ["newNotificationId", "notif-", 10],
  ["newIssueId", "issue-", 10],
  ["newEndpointId", "endpoint-", 10],
  ["newDeviceId", "device-", 10],
  ["newDeviceTokenId", "devtok-", 10],
  ["newEntityId", "ent-", 10],
  ["newRelationshipId", "rel-", 10],
  ["newOpenQuestionId", "oq-", 10],
  ["newGrantId", "grant-", 10],
  ["newApprovalId", "approval-", 10],
  ["newReceivedBackupId", "recvbak-", 10],
  ["newListId", "list-", 10],
  ["newListItemId", "item-", 10],
  ["newNasMountId", "nasmount-", 10],
  ["newEpisodeId", "ep-", 10],
  ["newFileId", "file-", 10],
  ["newShareId", "share-", 10],
  ["newArtifactId", "art-", 10],
  ["newArtifactKey", "artk-", 10],
  ["newProjectId", "project-", 10],
  ["newProjectArtifactId", "projart-", 10],
];

describe("id generators", () => {
  test("the table covers every newXxxId export", () => {
    const exported = Object.keys(ids).filter((name) => /^new[A-Z]/.test(name)).sort();
    expect(TABLE.map(([name]) => name).sort()).toEqual(exported);
  });
  for (const [name, prefix, length] of TABLE) {
    test(`${name} returns ${prefix} plus ${length} lowercase letters and digits`, () => {
      const make = (ids as unknown as Record<string, () => string>)[name]!;
      const value = make();
      expect(value.startsWith(prefix)).toBe(true);
      expect(value.slice(prefix.length)).toMatch(new RegExp(`^[a-z0-9]{${length}}$`));
    });
  }
  test("two ids from the same generator differ", () => {
    expect(ids.newPersonId()).not.toBe(ids.newPersonId());
  });
  test("randomSuffix returns the requested number of characters", () => {
    expect(ids.randomSuffix(6)).toMatch(/^[a-z0-9]{6}$/);
  });
});
