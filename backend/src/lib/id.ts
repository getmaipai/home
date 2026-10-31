// randomSuffix itself lives in @maipai/core/src/id now (core-v0.1.0,
// since it names no spec record type); every newXId() below still owns
// its own prefix and pattern, which is Home's own.
import { randomBytes } from "node:crypto";
import { randomSuffix } from "@maipai/core/src/id";
export { randomSuffix };

/** Matches spec/schemas/person.schema.json's `^person-[a-z0-9]{6,}$`. */
export function newPersonId(): string {
  return `person-${randomSuffix(10)}`;
}

/** Matches spec/schemas/api-key.schema.json's `^key_[a-z0-9]{6,}$`. The id is also the lookup half of a key secret
 * (`maipai_<id>_<random>`), so it is 96 random bits from the OS generator, not the shorter record suffix. */
export function newApiKeyId(): string {
  return `key_${randomBytes(12).toString("hex")}`;
}

/** Matches spec/schemas/biometric-print.schema.json's `^print-[a-z0-9]{6,}$`. */
export function newBiometricPrintId(): string {
  return `print-${randomSuffix(10)}`;
}

// Not a spec-shaped id (scheduled jobs aren't a spec 3.1 record type,
// see lib/scheduler.ts's header comment for why), so no schema pattern
// to match: just a stable, collision-resistant local id.
export function newJobId(): string {
  return `job-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (conversation turns aren't a spec 3.1
// record type, see lib/conversationHistory.ts's header comment for why).
export function newConversationTurnId(): string {
  return `turn-${randomSuffix(10)}`;
}

/** Answer block ids use the spec's `blk-` pattern. Undo receipts share the
 * confirmation block id because the kit reports that id with its action. */
export function newToolUndoId(): string {
  return `blk-${randomSuffix(10)}`;
}

/** Matches spec/schemas/reply-feedback.schema.json's `^rf-[a-z0-9]{6,}$`. */
export function newReplyFeedbackId(): string {
  return `rf-${randomSuffix(10)}`;
}

/** Matches spec/schemas/conversation.schema.json's `^conv-[a-z0-9]{6,}$`
 * (session-a-intelligence.md step 3: the conversation THREAD is a real
 * spec-shaped record, unlike the turn id above). */
export function newConversationId(): string {
  return `conv-${randomSuffix(10)}`;
}

/** Matches spec/schemas/chat-folder.schema.json's `^folder-[a-z0-9]{6,}$`
 * (PROJECTS-01a: a chat folder, shown as a Project). */
export function newChatFolderId(): string {
  return `folder-${randomSuffix(10)}`;
}

// Not a spec-shaped id either. Longer than the other ids here (16 chars,
// ~83 bits, vs. their 10/~52) on purpose: this one doubles as a bearer
// capability for routes/voice.ts's unauthenticated `GET /cloned/:id/file`
// route (the speech service, a separate unauthenticated process, fetches it
// by plain URL) - guessing it has to stay implausible, not merely
// unlikely, the same reasoning session.ts's own 32-byte token uses for
// the same class of problem.
export function newClonedVoiceId(): string {
  return `voice-${randomSuffix(16)}`;
}

// Not a spec-shaped id either (commands aren't a spec 3.1 record type,
// see lib/commands.ts's own header for why - the same call scheduledJobs
// already made).
export function newCommandId(): string {
  return `cmd-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (a delivered notification is hub-internal
// for the same reason scheduledJobs/commands are - see
// lib/notifications.ts's own header).
export function newNotificationId(): string {
  return `notif-${randomSuffix(10)}`;
}

/** Matches spec/schemas/issue.schema.json's `^issue-[a-z0-9]{6,}$`. */
export function newIssueId(): string {
  return `issue-${randomSuffix(10)}`;
}

// Not a spec-shaped id either (a managed hub-endpoint row is hub-
// internal, the same reason db/schema.ts's hubEndpoints table comment
// gives).
export function newEndpointId(): string {
  return `endpoint-${randomSuffix(10)}`;
}

/** Matches spec/schemas/device.schema.json's `^device-[a-z0-9]{6,}$`. */
export function newDeviceId(): string {
  return `device-${randomSuffix(10)}`;
}

// Not a spec-shaped id (a device token row is hub-internal - the token
// itself, not its id, is what a client ever sees, and only as a raw
// secret returned once, never a persisted identifier).
export function newDeviceTokenId(): string {
  return `devtok-${randomSuffix(10)}`;
}

/** Matches spec/schemas/entity.schema.json's `^ent-[a-z0-9]{6,}$`.
 * Distinct from the `ent<seq>-<device6>` ids memory records mint for
 * their own entity-mention rows (lib/memoryId.ts) - those are memory
 * rows, these are step 7's structured Entity records. */
export function newEntityId(): string {
  return `ent-${randomSuffix(10)}`;
}

/** Matches spec/schemas/relationship.schema.json's `^rel-[a-z0-9]{6,}$`. */
export function newRelationshipId(): string {
  return `rel-${randomSuffix(10)}`;
}

/** Matches spec/schemas/open-question.schema.json's `^oq-[a-z0-9]{6,}$`. */
export function newOpenQuestionId(): string {
  return `oq-${randomSuffix(10)}`;
}

/** Matches spec/schemas/grant.schema.json's `^grant-[a-z0-9]{6,}$`. */
export function newGrantId(): string {
  return `grant-${randomSuffix(10)}`;
}

// Not a spec-shaped id (the approval queue is hub-internal, the same
// reason scheduledJobs/commands/issues are).
export function newApprovalId(): string {
  return `approval-${randomSuffix(10)}`;
}

// Not a spec-shaped id (received_backups is hub-internal, the same
// reason scheduledJobs/commands/issues are).
export function newReceivedBackupId(): string {
  return `recvbak-${randomSuffix(10)}`;
}

/** Matches spec/schemas/list.schema.json's `^list-[a-z0-9]{6,}$`. */
export function newListId(): string {
  return `list-${randomSuffix(10)}`;
}

/** Matches spec/schemas/list.schema.json's own item `^item-[a-z0-9]{6,}$`. */
export function newListItemId(): string {
  return `item-${randomSuffix(10)}`;
}

// Not a spec-shaped id (nas_mounts is hub-internal, declaration only -
// see db/schema.ts's own comment).
export function newNasMountId(): string {
  return `nasmount-${randomSuffix(10)}`;
}

// Episodes: turn verbatim records for hybrid recall (MEM-03).
export function newEpisodeId(): string {
  return `ep-${randomSuffix(10)}`;
}

/** Matches spec/schemas/file.schema.json's `^file-[a-z0-9]{6,}$` (STORE-SPEC-01:
 * the old attachment.schema.json generalized into file.schema.json). */
export function newFileId(): string {
  return `file-${randomSuffix(10)}`;
}

/** Not a spec record: a LIBRARY-DEDUP-01 reference row (lib/fileContent.ts) is Home's own storage bookkeeping. */
export function newFileReferenceId(): string {
  return `fref-${randomSuffix(10)}`;
}

/** Matches spec/schemas/share.schema.json's `^share-[a-z0-9]{6,}$`
 * (STORE-SHARE-01). */
export function newShareId(): string {
  return `share-${randomSuffix(10)}`;
}

/** Matches spec/schemas/artifact.schema.json's `^art-[a-z0-9]{6,}$`. A new
 * one is minted for every version, chained by parent_version. */
export function newArtifactId(): string {
  return `art-${randomSuffix(10)}`;
}

// Not a spec-shaped id: db/schema.ts's own artifacts.artifactKey, Home-
// internal bookkeeping grouping one artifact's version chain so the
// current-version pointer has something stable to key on. Minted once at
// version 1 and copied onto every later version in the same chain.
export function newArtifactKey(): string {
  return `artk-${randomSuffix(10)}`;
}

/** Matches spec/schemas/project.schema.json's `id` (a non-empty string,
 * no fixed pattern - the schema names no prefix requirement). */
export function newProjectId(): string {
  return `project-${randomSuffix(10)}`;
}

/** Matches spec/schemas/project.schema.json's `$defs.ProjectArtifact.id`
 * (also just a non-empty string). Distinct prefix from newArtifactId()
 * above: that one mints the chat program's own artifacts.schema.json
 * records, a different spec shape entirely. */
export function newProjectArtifactId(): string {
  return `projart-${randomSuffix(10)}`;
}

/** Matches spec/schemas/feed.schema.json's `^feed-[a-z0-9]{6,}$` (KS-05). */
export function newFeedId(): string {
  return `feed-${randomSuffix(10)}`;
}

/** Matches spec/schemas/news-item.schema.json's `^news-[a-z0-9]{6,}$` (KS-05). */
export function newNewsItemId(): string {
  return `news-${randomSuffix(10)}`;
}

/** Matches spec/schemas/news-interest.schema.json's `^interest-[a-z0-9]{6,}$` (NEWS-02). */
export function newNewsInterestId(): string {
  return `interest-${randomSuffix(10)}`;
}

/** Matches spec/schemas/news-save.schema.json's `^save-[a-z0-9]{6,}$` (NEWS-02). */
export function newNewsSaveId(): string {
  return `save-${randomSuffix(10)}`;
}

/** Matches spec ReferenceSave's `^refsave-[a-z0-9]{6,}$` id. */
export function newReferenceSaveId(): string {
  return `refsave-${randomSuffix(10)}`;
}

/** Matches spec/schemas/news-search-recent.schema.json's `^recent-[a-z0-9]{6,}$` (NEWS-LOOK-02). */
export function newNewsSearchRecentId(): string {
  return `recent-${randomSuffix(10)}`;
}

/** Matches spec/schemas/news-read.schema.json's `^read-[a-z0-9]{6,}$` (NEWS-02). */
export function newNewsReadId(): string {
  return `read-${randomSuffix(10)}`;
}

// IMGGEN-HOME-01: a picture job (hub-internal, like approvals).
export function newPictureJobId(): string {
  return `pic-${randomSuffix(10)}`;
}

// MUSIC-GEN-03: music jobs are hub-internal, like picture and video jobs.
export function newMusicJobId(): string { return `mus-${randomSuffix(10)}`; }

// VIDEO-GEN-05: a video job (hub-internal, like picture jobs and approvals).
export function newVideoJobId(): string {
  return `vid-${randomSuffix(10)}`;
}

// MEDIA-LIB-01 / MEDIA-PROGRESS-01: the four media records (spec MediaItem, MediaSource, MediaProgress, MediaCollection).
export function newMediaItemId(): string {
  return `media-${randomSuffix(10)}`;
}
export function newMediaSourceId(): string {
  return `msrc-${randomSuffix(10)}`;
}
export function newMediaProgressId(): string {
  return `mprg-${randomSuffix(10)}`;
}
export function newMediaCollectionId(): string {
  return `mcol-${randomSuffix(10)}`;
}
