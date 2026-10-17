// NEWS-02: the fixed topic set (spec/news/topics.json), read once. A topic is offered to a user type only when its `bands` say so
// (`kids` to the child band; the rest to teens and adults).
import topicsFile from "@maipai/spec/news/topics.json" with { type: "json" };
import { NewsTopics } from "@maipai/spec/gen/ts/news-topics.js";
import type { AgeBand } from "@/lib/ageBand";

const parsed = NewsTopics.parse(topicsFile);
export const TOPICS = parsed.topics;

export function topicsFor(band: AgeBand) {
  return TOPICS.filter((topic) => (topic.bands as readonly string[]).includes(band));
}

export function topicById(id: string) {
  return TOPICS.find((topic) => topic.id === id);
}

/** Whether a topic id is one this user type is offered. */
export function topicOfferedTo(id: string, band: AgeBand): boolean {
  return topicsFor(band).some((topic) => topic.id === id);
}
