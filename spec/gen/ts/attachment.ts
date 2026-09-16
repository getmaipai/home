// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/attachment.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One immutable record for a file a person sent in chat. The bytes live below the household data directory; this record carries only their per-person ownership, turn provenance, integrity and retention policy.*/
export const Attachment = z
  .object({
    /**Stable attachment id, never reused. The id is also the basename used by the storage path.*/
    id: z
      .string()
      .regex(new RegExp("^att-[a-z0-9]{6,}$"))
      .describe(
        "Stable attachment id, never reused. The id is also the basename used by the storage path.",
      ),
    /**The signed-in person who sent the file. Ownership is captured at write time and is not inferred from a later profile change.*/
    owner_person_id: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "The signed-in person who sent the file. Ownership is captured at write time and is not inferred from a later profile change.",
      ),
    /**The conversation that received the file.*/
    conversation_id: z
      .string()
      .regex(new RegExp("^conv-[a-z0-9]{6,}$"))
      .describe("The conversation that received the file."),
    /**The turn whose user message carried the file.*/
    turn_id: z
      .string()
      .regex(new RegExp("^turn-[a-z0-9]{6,}$"))
      .describe("The turn whose user message carried the file."),
    /**Normalized MIME media type supplied to the attachment pipeline, without parameters.*/
    media_type: z
      .string()
      .regex(
        new RegExp(
          "^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$",
        ),
      )
      .describe(
        "Normalized MIME media type supplied to the attachment pipeline, without parameters.",
      ),
    /**Exact byte length of the stored file.*/
    size: z
      .number()
      .int()
      .gte(0)
      .describe("Exact byte length of the stored file."),
    /**Lowercase SHA-256 digest of the stored bytes, used to verify a read never changed the upload.*/
    sha256: z
      .string()
      .regex(new RegExp("^[a-f0-9]{64}$"))
      .describe(
        "Lowercase SHA-256 digest of the stored bytes, used to verify a read never changed the upload.",
      ),
    /**A normalized relative path below the household data directory. Implementations place it under people/{owner_person_id}/attachments/ and reject traversal or absolute paths.*/
    storage_path: z
      .string()
      .regex(new RegExp("^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$"))
      .describe(
        "A normalized relative path below the household data directory. Implementations place it under people/{owner_person_id}/attachments/ and reject traversal or absolute paths.",
      ),
    /**The file follows the owning conversation's household.conversation_retention_days setting, currently 7-365 days with a 90-day default. It is deleted with the owning turn and immediately by host.data.forget(person); it has no longer-lived attachment retention class.*/
    retention: z
      .literal("conversation")
      .describe(
        "The file follows the owning conversation's household.conversation_retention_days setting, currently 7-365 days with a 90-day default. It is deleted with the owning turn and immediately by host.data.forget(person); it has no longer-lived attachment retention class.",
      ),
    /**How this record entered the hub, such as composer:upload. It identifies the local path through the turn and adapter, not a remote service.*/
    provenance: z
      .string()
      .min(1)
      .describe(
        "How this record entered the hub, such as composer:upload. It identifies the local path through the turn and adapter, not a remote service.",
      ),
    created_at: z.string().datetime({ offset: true }),
    /**Hybrid logical clock for the immutable record, matching the shared record envelope.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock for the immutable record, matching the shared record envelope.",
      ),
  })
  .strict()
  .describe(
    "One immutable record for a file a person sent in chat. The bytes live below the household data directory; this record carries only their per-person ownership, turn provenance, integrity and retention policy.",
  );
export type Attachment = z.infer<typeof Attachment>;
