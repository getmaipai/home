// MEM-SPACE-02: Home's own CPU-only side work (document parsing, OCR, video keyframes) starts at background priority, so a chat turn on the same cores
// never waits behind it. On macOS `taskpolicy -b` puts the process on the efficiency cores and throttles its disk I/O. It frees no memory and
// the GPU has no priority control, so GPU jobs keep the heavy gate. Elsewhere, and when taskpolicy is missing, the command runs as given.
import { existsSync } from "node:fs";

const TASKPOLICY = "/usr/sbin/taskpolicy";

/** `cmd` prefixed to run at background priority when this machine can, otherwise unchanged. */
export function atBackgroundPriority(cmd: string[], platform: string = process.platform, exists: (path: string) => boolean = existsSync): string[] {
  return platform === "darwin" && exists(TASKPOLICY) ? [TASKPOLICY, "-b", ...cmd] : cmd;
}
