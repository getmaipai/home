DROP TRIGGER `conversation_turns_au`;
--> statement-breakpoint
CREATE TRIGGER `conversation_turns_au` AFTER UPDATE ON `conversation_turns`
WHEN old.user_text IS NOT new.user_text OR old.reply_text IS NOT new.reply_text
BEGIN
  INSERT INTO `conversation_turns_fts` (conversation_turns_fts, rowid, user_text, reply_text) VALUES ('delete', old.rowid, old.user_text, old.reply_text);
  INSERT INTO `conversation_turns_fts` (rowid, user_text, reply_text) VALUES (new.rowid, new.user_text, new.reply_text);
END;
