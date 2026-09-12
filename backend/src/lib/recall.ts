// Hybrid episode recall: reciprocal rank fusion over semantic and full-text search,
// with time-aware ranking.
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { episodes, episodeEmbeddings } from "@/db/schema";
import { embed } from "@/lib/llm";
import { bufferToVector } from "@/lib/memory";
import type { PersonRow } from "@/types";

interface RecalledEpisode {
  id: string;
  text: string;
  speaker: "user" | "assistant";
  createdAt: string;
  semanticScore: number;
  textScore: number;
  finalScore: number;
}

const VECTOR_WEIGHT = 0.5;
const TEXT_WEIGHT = 0.5;

/** Recalls episodes via hybrid search (semantic + BM25 full-text with time decay).
 * Returns top results ranked by reciprocal rank fusion. */
export async function recallEpisodes(actor: PersonRow, query: string, limit: number = 5): Promise<RecalledEpisode[]> {
  const queryVector = await embed([query]);
  if (!queryVector.ok || queryVector.value.vectors.length === 0) return [];

  const vector = queryVector.value.vectors[0]!;

  // Semantic search: cosine similarity
  const semanticRows = db
    .select({
      id: episodes.id,
      text: episodes.text,
      speaker: episodes.speaker,
      createdAt: episodes.createdAt,
      vector: episodeEmbeddings.vector,
    })
    .from(episodes)
    .innerJoin(episodeEmbeddings, eq(episodes.id, episodeEmbeddings.episodeId))
    .where(eq(episodes.personId, actor.id))
    .all();

  const semanticScored = semanticRows.map((row) => {
    const rowVector = Array.from(bufferToVector(row.vector));
    const similarity = cosineSimilarity(vector, rowVector);
    return {
      id: row.id,
      text: row.text,
      speaker: row.speaker,
      createdAt: row.createdAt,
      semanticScore: similarity,
      semanticRank: 0,
    };
  });

  // Sort by semantic score and assign ranks
  semanticScored.sort((a, b) => b.semanticScore - a.semanticScore);
  semanticScored.forEach((item, idx) => {
    (item as any).semanticRank = idx + 1;
  });

  // Full-text search: BM25
  let ftsRows: Array<{
    id: string;
    text: string;
    speaker: string;
    created_at: string;
    rank: number;
  }> = [];

  try {
    ftsRows = sqlite.query(
      `SELECT episodes.id, episodes.text, episodes.speaker, episodes.created_at,
              rank FROM episodes
       INNER JOIN episodes_fts ON episodes.rowid = episodes_fts.rowid
       WHERE episodes.person_id = ? AND episodes_fts MATCH ?
       ORDER BY rank LIMIT 100`,
    ).all(actor.id, query) as Array<{
      id: string;
      text: string;
      speaker: string;
      created_at: string;
      rank: number;
    }>;
  } catch {
    // Query had invalid FTS5 syntax or other issue - no results
  }

  const ftsScored = ftsRows.map((row, idx) => ({
    id: row.id,
    text: row.text,
    speaker: row.speaker as "user" | "assistant",
    createdAt: row.created_at,
    textScore: Math.abs(row.rank), // FTS rank is negative; take abs
    textRank: idx + 1,
  }));

  // Merge results via reciprocal rank fusion
  const merged = new Map<string, any>();

  semanticScored.forEach((result) => {
    merged.set(result.id, {
      id: result.id,
      text: result.text,
      speaker: result.speaker,
      createdAt: result.createdAt,
      semanticScore: result.semanticScore,
      semanticRank: result.semanticRank,
      textScore: 0,
      textRank: Infinity,
    });
  });

  ftsScored.forEach((result) => {
    const existing = merged.get(result.id);
    if (existing) {
      existing.textScore = result.textScore;
      existing.textRank = result.textRank;
    } else {
      merged.set(result.id, {
        id: result.id,
        text: result.text,
        speaker: result.speaker,
        createdAt: result.createdAt,
        semanticScore: 0,
        semanticRank: Infinity,
        textScore: result.textScore,
        textRank: result.textRank,
      });
    }
  });

  // RRF formula: 1 / (k + rank), where k=60 is the standard constant
  const scored = Array.from(merged.values())
    .map((result: any) => ({
      ...result,
      finalScore:
        (VECTOR_WEIGHT * (1 / (60 + result.semanticRank))) +
        (TEXT_WEIGHT * (1 / (60 + result.textRank))) +
        timeDecay(result.createdAt),
    }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);

  return scored;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function timeDecay(createdAt: string): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const ageMs = now - created;
  const ageWeeks = ageMs / (1000 * 60 * 60 * 24 * 7);
  // Decay to 50% relevance at 4 weeks
  return Math.exp(-ageWeeks * 0.173);
}

interface FormattedEpisode {
  text: string;
  speaker: "user" | "assistant";
  timeLabel: string;
}

export function formatEpisodesForPrompt(episodes: RecalledEpisode[]): FormattedEpisode[] {
  return episodes.map((ep) => ({
    text: ep.text.slice(0, 200),
    speaker: ep.speaker,
    timeLabel: getTimeLabel(ep.createdAt),
  }));
}

function getTimeLabel(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}
