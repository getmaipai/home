// Import this first in any rig that talks to the lab: `import "./lockguard";`. Exits with a plain message while a clean run holds the lab.
import { guardOrExit } from "../src/runLock";
guardOrExit(process.argv[1]?.split("/").pop() ?? "rig");
