// CANARY-01: the built-in "health" actor. It is not a row in `people`: nothing can sign in as it, list it or find it in a
// roster. Its turns run in temporary mode (process memory only) and its session is discarded after each check.
import type { PersonRow } from "@/types";

export const HEALTH_ACTOR_ID = "person-systemhealth";

export function healthActor(): PersonRow {
  const at = "2026-01-01T00:00:00.000Z";
  return {
    id: HEALTH_ACTOR_ID,
    displayName: "Health check",
    nickname: null,
    bio: null,
    accent: null,
    birthdate: "1980-01-01",
    role: "adult",
    avatarSeed: "person-systemhealth",
    source: "system",
    localOnly: true,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    hlc: "0",
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
  } as PersonRow;
}
