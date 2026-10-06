import type { CrisisSupport } from "@maipai/home-backend/src/wire";

export class ChatTurnError extends Error {
  /** SAFETY-NOTICE-01: the crisis resources a safety refusal carried, drawn
   * as one support notice in place of the refusal line. */
  constructor(message: string, readonly code: string, readonly turnId?: string, readonly crisisSupport?: CrisisSupport) {
    super(message);
    this.name = "ChatTurnError";
  }
}
