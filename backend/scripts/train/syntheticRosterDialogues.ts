// ACT-02: synthetic roster dialogues, authored for this training corpus
// because none existed (BACKLOG.md's ACT-02 item names them as one of
// the four label-source corpora; the research pass for this lane found
// no existing file). Persona-roster names only (org CLAUDE.md's privacy
// rule), each utterance a plausible thing a household member says to
// MaiPai. Text only, no engine, no household data: authored by hand to
// cover classes the task-oriented public corpora (Taskmaster-1, CCPE-M)
// are thin on - greeting, closing and backchannel (DailyDialog folds
// them into inform, so nothing else in this pipeline has them at
// volume), reported/quoted/hypothetical/joke stance, and commissive
// acts - not hand-labeled: every line goes through the same 4B labeling
// pass as the rest of the corpus, so this file only has to get the
// TEXT right, not the tags.
export const SYNTHETIC_ROSTER_DIALOGUES: readonly string[] = [
  // Greetings
  "good morning",
  "hey there",
  "morning MaiPai",
  "hi, how's it going",
  "hello",
  "evening",
  "hiya",
  "what's up",
  "good afternoon",
  "hey, you around",

  // Closings
  "alright, that's all for now",
  "ok thanks, night",
  "talk to you later",
  "I'm heading to bed",
  "bye for now",
  "that's everything for tonight",
  "ok I'm done, thanks",
  "catch you later",
  "goodnight",
  "I gotta go, bye",

  // Backchannels
  "ok",
  "got it",
  "cool",
  "nice",
  "wow",
  "gotcha",
  "sounds good",
  "makes sense",
  "no way",
  "huh",

  // Commissives
  "I'll add it to the list myself later",
  "I'm going to call the vet tomorrow",
  "I promise I'll water the plants",
  "I'll take care of it after dinner",
  "we're going to repaint the fence this weekend",
  "I'll let you know how it goes",
  "I'm gonna fix that tonight",
  "I'll grab milk on the way home",
  "count me in for Saturday",
  "I'll text Nadia about it",

  // Directives, imperative and suggestion forms
  "lock the front door",
  "turn off the kitchen light",
  "you should add eggs to the list",
  "let's plan the trip for next month",
  "don't forget to lock the door tonight",
  "remind me to call the dentist tomorrow",
  "why don't we try the new recipe this week",
  "you should really back up your photos",
  "put the leftovers in the fridge",
  "we should leave earlier next time",

  // Questions, some without a question mark
  "what time is the appointment",
  "how long until the timer goes off",
  "wondering if Rover's had his walk yet",
  "any idea when Marlow gets home",
  "not sure what we're doing for dinner",
  "does anyone know where the remote went",
  "curious what the weather's like tomorrow",
  "what's the wifi password again",

  // Reported stance
  "Pippa said she doesn't like mushrooms",
  "Sage told me the recital got moved to Friday",
  "my coworker Raven mentioned the office is closed Monday",
  "Marlow said he finished his homework already",
  "Quill texted that he'll be late",
  "the vet said Rover needs a follow-up next month",
  "Juniper mentioned she's allergic to shellfish",
  "Atlas said he wants pizza for his birthday",
  "the school said picture day is next Tuesday",
  "Willow told me the game got rescheduled",

  // Quoted stance
  "Pippa looked right at me and said, \"I already fed the dog\"",
  "she said, \"I'll be home by six\"",
  "Marlow yelled \"I'm not tired!\" from his room",
  "the mechanic said \"it'll be ready by Thursday\"",
  "Nadia texted \"running ten minutes late\"",
  "he said \"leave it on the porch\"",
  "she wrote \"see you at the game\"",

  // Hypothetical stance
  "if it rains tomorrow we should move the picnic inside",
  "what if we tried a different route to school",
  "imagine if the whole family could go on vacation together",
  "I wish I had more time to garden this year",
  "suppose the flight gets delayed, what's the backup plan",
  "if Rover keeps chewing shoes we might need a trainer",
  "what if we surprised Marlow for his birthday",
  "I'd love it if we could repaint the porch this summer",

  // Joke stance
  "ha, I'm basically a professional chef now",
  "yeah right, like that's ever going to happen",
  "jk, I actually love doing the dishes",
  "as if I'd ever forget your birthday",
  "lol I definitely did not eat the last cookie",
  "sure, and pigs can fly too",
  "haha I'm totally not procrastinating right now",

  // Inform, plain statements
  "Pippa is allergic to peanuts",
  "the dentist appointment is on Thursday at four",
  "Rover's vet visit got moved to Wednesday",
  "Marlow's birthday is in June",
  "the wifi password is on the fridge",
  "we're out of milk",
  "the dishwasher is making a weird noise",
  "Atlas turned four last month",
  "the recital starts at seven",
  "Quill drinks seltzer, not soda",

  // Emotion-bearing turns for realistic mixed act+emotion pairs
  "I'm really excited about the trip next week",
  "I'm so frustrated the delivery got delayed again",
  "honestly I'm a little worried about the storm tonight",
  "I'm devastated we had to cancel the reunion",
  "that's disgusting, the milk went bad again",
  "I can't believe we won the game",
  "I'm nervous about the presentation tomorrow",
];
