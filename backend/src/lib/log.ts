// Home's own structured log file, data/logs/hub.log - the rotation and
// console-mirror logic lives in @maipai/core/src/log now (core-v0.1.0);
// this is just Home's own instance (its data directory, its log name).
import { createLogger } from "@maipai/core/src/log";
import { logsDir } from "@/lib/paths";

const logger = createLogger(logsDir, "hub");

export const appendLogLine = logger.appendLine;
export const installConsoleFileMirror = logger.installConsoleMirror;
export const installFatalErrorHandlers = logger.installFatalErrorHandlers;
