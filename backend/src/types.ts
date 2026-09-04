import type { people } from "@/db/schema";

export type PersonRow = typeof people.$inferSelect;

export type AppEnv = {
  Variables: {
    person: PersonRow;
  };
};
