-- CHAT-09: embedding identity (preprocess version) for memory, episode,
-- and routing embedding tables. Existing rows get 'v1' (current
-- preprocessing: raw documents/queries, routing document prefix).
ALTER TABLE memory_embeddings ADD COLUMN preprocess text NOT NULL DEFAULT 'v1';--> statement-breakpoint
ALTER TABLE episode_embeddings ADD COLUMN preprocess text NOT NULL DEFAULT 'v1';--> statement-breakpoint
ALTER TABLE routing_embeddings ADD COLUMN preprocess text NOT NULL DEFAULT 'v1';
