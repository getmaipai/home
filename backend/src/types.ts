import type { people, memoryRecords } from "@/db/schema";

export type PersonRow = typeof people.$inferSelect;
export type MemoryRecordRow = typeof memoryRecords.$inferSelect;

export type AppEnv = {
  Variables: {
    person: PersonRow;
    sessionId: string;
    deviceId: string;
    /** Set by requireApiKey: the key a bearer request used (its id and own per-minute limit); never the secret. */
    apiKey: { id: string; requestsPerMinute: number | null; /** Set for a per-session coding key: the Code session it is bound to. */ sessionId?: string; /** The tier the key was minted for. */ keyTier?: "standard" | "boost" | "max" };
  };
};
