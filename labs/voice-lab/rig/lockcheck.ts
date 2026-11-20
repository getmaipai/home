// For shell scripts (page restart, voice server restart): `bun labs/voice-lab/rig/lockcheck.ts || exit 3`.
import { guardOrExit } from "../src/runLock";
guardOrExit("restart");
