const topics = ["kitchen", "weather", "travel", "school", "repair", "garden", "question list", "list", "date", "number"];
const moods = ["bright", "quiet", "tidy", "warm", "cool", "ready", "safe"];
const objects = ["the pantry", "a rain gauge", "the bus map", "the class list", "a loose hinge", "the seed bed", "the question cards", "the shopping list", "the calendar", "the tally sheet"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const EMBED_PROOF_SENTENCES: string[] = [
  ...topics.flatMap((topic) => moods.map((mood) => `The ${topic} feels ${mood} today.`)).slice(0, 67),
  ...topics.flatMap((topic) => days.map((day) => `On ${day}, the ${topic} team checked ${objects[topics.indexOf(topic)]} before the morning schedule began.`)).slice(0, 67),
  ...topics.flatMap((topic, topicIndex) => days.map((day, dayIndex) => `On ${day}, the ${topic} team checked ${objects[topicIndex]} at ${dayIndex + 1}:30, wrote the date on a clean card, compared the count with yesterday, and left a clear note beside the door for anyone who needed the next step.`)).slice(0, 66),
];
