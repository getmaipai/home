import type { people, memoryRecords } from "@/db/schema";

export type PersonRow = typeof people.$inferSelect;
export type MemoryRecordRow = typeof memoryRecords.$inferSelect;

export type AppEnv = {
  Variables: {
    person: PersonRow;
  };
};
