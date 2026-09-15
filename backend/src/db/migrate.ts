// Importing "@/db" is what applies the migrations: first the schema-version
// guard, then the staged restore, then the factory reset, then migrate().
// This script exists so `bun run db:migrate` applies them to the configured
// data directory without starting the server.
import { dataDir } from "@/lib/paths";
await import("@/db");
console.log(`[db] migrations applied to ${dataDir}`);
