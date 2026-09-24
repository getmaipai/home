-- SHELL-SEARCH-03: an FTS5 index over conversation_turns' own message
-- bodies, the same pattern 0028_parallel_living_lightning.sql already
-- used for episodes_fts (content='<table>', content_rowid='rowid' -
-- the index stores no second copy of the text itself, only the
-- tokenized postings). conversation_turns.id is TEXT, not an INTEGER
-- PRIMARY KEY, so it never aliases SQLite's own implicit rowid - the
-- triggers below read/write `rowid` on purpose, not `id`.
CREATE VIRTUAL TABLE `conversation_turns_fts` USING fts5(user_text, reply_text, content='conversation_turns', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER `conversation_turns_ai` AFTER INSERT ON `conversation_turns` BEGIN
  INSERT INTO `conversation_turns_fts` (rowid, user_text, reply_text) VALUES (new.rowid, new.user_text, new.reply_text);
END;--> statement-breakpoint
CREATE TRIGGER `conversation_turns_ad` AFTER DELETE ON `conversation_turns` BEGIN
  INSERT INTO `conversation_turns_fts` (conversation_turns_fts, rowid, user_text, reply_text) VALUES ('delete', old.rowid, old.user_text, old.reply_text);
END;--> statement-breakpoint
CREATE TRIGGER `conversation_turns_au` AFTER UPDATE ON `conversation_turns` BEGIN
  INSERT INTO `conversation_turns_fts` (conversation_turns_fts, rowid, user_text, reply_text) VALUES ('delete', old.rowid, old.user_text, old.reply_text);
  INSERT INTO `conversation_turns_fts` (rowid, user_text, reply_text) VALUES (new.rowid, new.user_text, new.reply_text);
END;--> statement-breakpoint
-- The table already has real rows (unlike episodes_fts, created fresh
-- alongside episodes itself) - a household's existing history has to
-- be searchable from the moment this migration runs, not just what it
-- writes from here on.
INSERT INTO `conversation_turns_fts` (rowid, user_text, reply_text) SELECT `rowid`, `user_text`, `reply_text` FROM `conversation_turns`;
