// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/device.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**A physical device the household has paired with the hub - a phone, a TV, a desktop, a browser, or (later) a robot or a pod (session-f-platform-and-trust.md step 6, platform plan 7.1). Laid now because device tokens and Quick Connect both need somewhere to hang a name/kind/area/capabilities, and Wave 3's link pairs a robot into this exact shape - not because the full device-management feature (renaming, per-device settings) exists yet. A Device row is created the first time a device token is minted for it (via Quick Connect approval or a native passkey sign-in); deleting it revokes every token that points at it.*/
export const Device = z
  .object({
    id: z.string().regex(new RegExp("^device-[a-z0-9]{6,}$")),
    /**A closed set (platform plan 7.1). `robot`/`pod` are placeholders for Wave 3's link - nothing in this wave mints those kinds.*/
    kind: z
      .enum(["robot", "pod", "tv", "phone", "desktop", "browser"])
      .describe(
        "A closed set (platform plan 7.1). `robot`/`pod` are placeholders for Wave 3's link - nothing in this wave mints those kinds.",
      ),
    /**What the household calls it - "Living room TV", "Jesse's phone". Supplied by the pairing client (Quick Connect's label, or a passkey sign-in's device name), never invented here.*/
    name: z
      .string()
      .min(1)
      .max(60)
      .describe(
        'What the household calls it - "Living room TV", "Jesse\'s phone". Supplied by the pairing client (Quick Connect\'s label, or a passkey sign-in\'s device name), never invented here.',
      ),
    /**A free-text room/location label ("Living room"), optional. Not a fixed vocabulary - a household's own rooms aren't a closed set.*/
    area: z
      .union([
        z
          .string()
          .max(60)
          .describe(
            "A free-text room/location label (\"Living room\"), optional. Not a fixed vocabulary - a household's own rooms aren't a closed set.",
          ),
        z
          .null()
          .describe(
            "A free-text room/location label (\"Living room\"), optional. Not a fixed vocabulary - a household's own rooms aren't a closed set.",
          ),
      ])
      .describe(
        "A free-text room/location label (\"Living room\"), optional. Not a fixed vocabulary - a household's own rooms aren't a closed set.",
      )
      .default(null),
    /**From the capability vocabulary (spec/vocab/capabilities.json), same convention manifest.schema.json's `requires`/`optional` use. Empty for every device this wave mints (a phone or TV pairing today declares none); populated once a client actually reports its own capabilities.*/
    capabilities: z
      .array(z.string())
      .describe(
        "From the capability vocabulary (spec/vocab/capabilities.json), same convention manifest.schema.json's `requires`/`optional` use. Empty for every device this wave mints (a phone or TV pairing today declares none); populated once a client actually reports its own capabilities.",
      )
      .default([]),
    /**The person currently paired to this device - whoever approved the Quick Connect request or completed the passkey ceremony that minted it. A shared household device re-paired to a different family member gets a new Device row, not a person_id change: the token that authenticated the old person is revoked first (deleting its Device row), so there is never a live token whose person_id has silently drifted out from under it.*/
    person_id: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "The person currently paired to this device - whoever approved the Quick Connect request or completed the passkey ceremony that minted it. A shared household device re-paired to a different family member gets a new Device row, not a person_id change: the token that authenticated the old person is revoked first (deleting its Device row), so there is never a live token whose person_id has silently drifted out from under it.",
      ),
    /**Per-record-type sync cursors Wave 3's link will populate ("how far this device has synced"). Always `{}` until the link exists - laid now only so the shape doesn't need a migration when it does.*/
    watermarks: z
      .record(z.string(), z.any())
      .describe(
        "Per-record-type sync cursors Wave 3's link will populate (\"how far this device has synced\"). Always `{}` until the link exists - laid now only so the shape doesn't need a migration when it does.",
      )
      .default({}),
    /**Updated whenever this device's token is redeemed for a session - lets a person tell a device that's actually in use apart from one they paired once and forgot.*/
    last_seen_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "Updated whenever this device's token is redeemed for a session - lets a person tell a device that's actually in use apart from one they paired once and forgot.",
          ),
        z
          .null()
          .describe(
            "Updated whenever this device's token is redeemed for a session - lets a person tell a device that's actually in use apart from one they paired once and forgot.",
          ),
      ])
      .describe(
        "Updated whenever this device's token is redeemed for a session - lets a person tell a device that's actually in use apart from one they paired once and forgot.",
      )
      .default(null),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    /**Hybrid logical clock, the same shape every other record's hlc uses (7.3). Hub-local for now (Devices don't sync until Wave 3's link exists) - stamped from the first record this platform ever wrote one for.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock, the same shape every other record's hlc uses (7.3). Hub-local for now (Devices don't sync until Wave 3's link exists) - stamped from the first record this platform ever wrote one for.",
      ),
  })
  .strict()
  .describe(
    "A physical device the household has paired with the hub - a phone, a TV, a desktop, a browser, or (later) a robot or a pod (session-f-platform-and-trust.md step 6, platform plan 7.1). Laid now because device tokens and Quick Connect both need somewhere to hang a name/kind/area/capabilities, and Wave 3's link pairs a robot into this exact shape - not because the full device-management feature (renaming, per-device settings) exists yet. A Device row is created the first time a device token is minted for it (via Quick Connect approval or a native passkey sign-in); deleting it revokes every token that points at it.",
  );
export type Device = z.infer<typeof Device>;
