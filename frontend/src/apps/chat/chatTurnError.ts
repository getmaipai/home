export class ChatTurnError extends Error {
  constructor(message: string, readonly code: string, readonly turnId?: string) {
    super(message);
    this.name = "ChatTurnError";
  }
}
