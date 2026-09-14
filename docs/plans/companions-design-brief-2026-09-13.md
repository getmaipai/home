# Companions: the design brief (2026-09-13, design pending)

Jesse's product direction from a brainstorm with the coordinator on
the evening of 2026-09-13, recorded as input for the design pass that
a stronger model will run. Nothing here is designed or scheduled;
Session A and Session B build nothing from this file until the pass
lands and its items reach the backlog. Findings from live use that
this direction answers are in
`media-conversation-program-2026-09-13.md`, "Findings from live use".

## Two renderings of one turn

A person sometimes wants a friend's answer and sometimes the details.
"Who is Corey Feldman" can be "the Goonies kid, Mouth" or a full
rundown; "how do I make banana bread" can be "it's easy, you need
ripe bananas and one bowl" or the recipe. The direction:

- The chat bubble is always the friend's line, in the companion's
  register. Encyclopedia prose never lands in the chat.
- The detail is a document, not a message: a pane on the right on a
  desktop, a bottom sheet on a phone, never read aloud on a voice-only
  surface (the robot, the TV from the couch), where it is "on your
  phone" or on the hub screen instead.
- Both come from the same evidence (the retained outcomes of CHAT-15;
  the composer of CHAT-16). One store, two renderings. Where the
  evidence is typed (a person card, a recipe, a comparison), the
  document is the typed shape with its sources, not model prose.
- A document exists only when the turn had material for one: a
  lookup ran, a typed source answered, or the ask is procedural or
  factual ("how do I", "who is", "compare"). Chit-chat produces none.
- Not auto-shown. A "Details" handle on the message, beside the
  source chips, opens it. Two exceptions: an explicit ask ("the whole
  recipe", "the full rundown") opens it and the chat says one line;
  the companion may offer it ("want the whole recipe?"). Once open it
  follows the subject and updates in place ("can I use frozen
  bananas?" edits the recipe), the living-document behavior.
- Research mode is a preference on a conversation: the pane stays
  open, the friend line gets shorter, still never an article in the
  bubble.
- Cost: the line is generated as today; the document is built from
  the evidence lazily when opened (or streamed after the line in
  research mode), so ordinary chat pays nothing extra.
- The model never chooses the register from the phrasing. The line is
  always casual for that companion; the detail is always available
  when evidence exists; the person chooses when to look. Same
  principle as lookups: the engine decides, not the model.

## Directness is a companion, not a mode

No "assistant mode" that turns the companion off: it would make the
companion a skin over a generic assistant and split memory and tone
across two personalities in one house. Instead:

- MaiPai is the default companion and the product's own voice:
  direct, complete, unpadded (the point first, short reasoning, no
  reactions or offers), the way a good assistant answers. The
  personalities (a buddy, a pal, a storyteller) are companion packages
  added on top.
- Every companion's register follows the ask within its personality:
  "just the numbers" gets the numbers from the warm one too.
- Long-form material goes to the details pane for every companion;
  what differs between companions is warmth and length in the bubble.
- Caution for later: the family surfaces (TV, robot, kids' profiles)
  should meet a companion first, and MaiPai direct should be the one
  you reach for, or people default to the direct one and never meet
  the companions.

## Many companions, per person

People keep several friends with different personalities, names and
voices and reach for each for different things (a formal British one
for troubleshooting, a casual one for talk). The direction:

- A companion is a name, a personality, a default register or
  specialty, a voice, a wake word and an avatar: a catalog package
  (companions, voices and wake words are already package categories;
  pal and buddy are bundled today).
- Companions are per person, not per hub. Each household member has
  their own set; a child's set is chosen by an adult from the
  kid-safe ones.
- Shared knowledge, separate rapport: every companion knows what the
  hub knows about the family (one memory), and each also has its own
  relationship with the person (what they talked about, running
  jokes, how it addresses them). That is one more scope on memory,
  per companion, not a second memory system.
- Switching is a name, not a menu: the wake word on voice, the name
  in the message or a header pick in chat, per message as the natural
  unit. Switching never changes the conversation or what the hub
  knows; it changes who is talking.
- The rule that makes all of this safe: nothing a companion says is
  produced by a different engine or prompt path. Same turn engine,
  same evidence ladder, same guards, same memory. A companion is a
  register, a voice and a rapport scope on top, so every correctness
  item landing today holds for every companion anyone installs.

## One wake word, two people, two companions

Jesse's question: dad says "MaiPai" and wants a formal British male;
mom says "MaiPai" and wants an informal English female; and any
person may use any wake word, prebuilt or newly trained.

The shape the coordinator proposes for the pass to judge:

- A wake word names a companion slot, not a fixed companion. "MaiPai"
  is a name each person binds to their own configuration of MaiPai
  (voice, register, personality). The wake-word detector answers
  "which name was said"; something else answers "who said it".
- Who said it is the speaker's identity: on a personal surface (a
  phone, a signed-in screen) the signed-in person; on a shared
  surface (the kitchen hub, the robot) speaker identification from
  the voice itself (an enrolled voice print per household member, the
  gap the 2026-09-05 audit named as "no speaker identity"), with the
  robot's face recognition as a second signal when it exists.
- The resolution: wake word gives the name; speaker gives the person;
  the person's binding of that name gives the companion (voice,
  register, personality, rapport scope). Unknown speaker gets the
  household's default binding of that name, and the reply may ask who
  is speaking when it matters (a personal memory, a child-safety
  decision), never when it does not.
- Wake words are packages: a prebuilt one installs from the catalog;
  a newly trained one is trained on the hub (the training rules in
  the org standards: real speech, near misses, verified data) and
  registered the same way. A person may bind any installed wake word
  to any of their companions, and two people may bind the same word
  to different companions.
- Shared devices (the robot, a kitchen display, a TV) get a device
  binding set by an admin: which companion answers on that device by
  default, per wake word. Resolution order for a voice turn: the
  identified speaker's own binding of the name; otherwise the
  device's admin-assigned binding; otherwise the household default.
  A device can also be marked personal (an office display) so its
  default is one person's binding without identification. The device
  registry already exists (spec `device.schema.json`); the binding is
  a field on it, one definition, synced to the robot.
- Consequences for the pass to weigh: speaker identification is now
  on the critical path for voice (it was a later item); wake-word
  training becomes a household feature with a UI; the robot needs the
  same resolution table synced from the hub (spec-shaped, no data
  debt); a companion's voice is chosen per binding, so voice packages
  are per person too.

## What the design pass produces

A design note in `docs/dev.md` and backlog items in the platform's
shape: the details pane and its document types; research mode; the
companion package's full shape (register, specialty, voice, wake
word, rapport scope); per-person companion sets and the kid-safe
rule; the wake word to companion binding table and speaker
identification; the robot parity path. Each with acceptance in the
bench's effect-based form and, for voice, a real-microphone check.
