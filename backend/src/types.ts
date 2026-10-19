import type { people, memoryRecords } from "@/db/schema";

export type PersonRow = typeof people.$inferSelect;
export type MemoryRecordRow = typeof memoryRecords.$inferSelect;

export type AppEnv = {
  Variables: {
    person: PersonRow;
    deviceId: string;
    /** Set by requireApiKey: the key a bearer request used (its id and own per-minute limit); never the secret. */
    apiKey: { id: string; requestsPerMinute: number | null };
  };
};
