# The harness: turns and projects (2026-09-26)

Design record. Owner-requested 2026-09-26 ("our harness design"). Status:
proposed, awaiting Jesse's read. Nothing here is built; the backlog items at
the end are the build plan.

## Why this exists

Home answers a prompt with one bounded model call and at most one tool round
(the shipping 8B's budget is `rounds: 1` in `modelCatalog.ts`). That shape is
right for "what time is it" and "turn off the lights", and ARCH-AGENT-01
deliberately kept it small: a wider loop on a small model is how the fish
tank got turned off. But a family also asks for things that are not a turn:
"make me a children's coloring book" is a story, eight drawings, and a
booklet, minutes of work across three engine roles. Today that request has
nowhere to go. There is no task decomposition, no background job for a turn,
and no way to hand a generator's minutes-long run back into a conversation
(the only job queue in Home downloads model files). The failure this design
prevents is the tempting wrong fix: inflating the turn loop into a general
agent loop, which breaks on small hardware, blows the voice latency budget,
and reopens the side-effect risk the bounded loop exists to contain.

The mess below this layer is real machinery that already works and must not
be duplicated: the turn machine's eight typed nodes, the per-model budget
records, the Stack's role addresses and its generator job API
(`POST /stack/v1/jobs`), the governor's memory admission. The thing above it
is the person in the chat, who says one sentence and expects either an
instant answer or honest progress on a bigger piece of work. The harness is
the one seam between those: it decides which of exactly two shapes a prompt
becomes, and it is the only place that decision lives.

## The two shapes

**A turn** is what exists: safety, the exact-match fast path, context, one
model call with tools under the model's budget, policy, answer, output gate.
Synchronous, seconds, the reply is the deliverable. Nothing in this design
changes the turn pipeline's nodes or widens its loop.

**A project** is a durable, typed plan of steps that runs in the background
after the turn that started it has already replied. Asynchronous, minutes,
the deliverable is one or more artifacts posted back into the thread. A
project is not a bigger turn and never runs inside one: the turn's only role
is to start it, and the runner that executes it is deterministic code, not a
model deciding what to do next.

The coloring book, as the worked example: the turn replies "Making your
dinosaur coloring book now, eight pages, a few minutes." The project then
runs story text (chat role), one image per page (image role, a Stack job
each), assembly into a PDF (a pure function), a safety gate per artifact,
and posts the finished book to the thread with a notification.

## How a project starts (recognition without word rules)

Understanding that a request is project-shaped is the model's job, never a
regex (org standard, RULES-AND-LEARNED-COMPONENTS.md). The mechanism is a
tool: the turn's model is offered `start_project` alongside the ordinary
tools, and its description says what it is for (a deliverable that needs
several generation steps or a generator run too long for a turn). The model
either answers normally or calls `start_project` with a project type and its
parameters. No new classifier, no phrase list, no second pipeline.

`start_project` is a consequential action and goes through the policy node
like any other: min_role from the project type's manifest, the existing
confirm/consent shape when the type declares it (anything that spends real
compute for minutes, or writes outside the thread), child rules from the
type's manifest exactly as package tools declare them today.

## Recipes first, model-authored plans as a budgeted capability

Every project type is a catalog package (the lean rule: Home holds only the
generic runner; every capability is a package). The package ships a
**recipe**: a typed, declarative list of steps with parameter slots the
model fills when it calls `start_project` ("topic: dinosaurs, pages: 8,
reader age: 5"). The coloring book, a bedtime story with pictures, a
birthday card, a family newsletter: each is a package with a recipe, and
installing the package is what makes the project type exist.

A model whose budget record grants `plan_authoring` may instead propose a
custom recipe built from the same step vocabulary, for requests no installed
recipe covers. The proposal is still data, validated by the same schema,
executed by the same runner, gated by the same policy; the model authors the
plan, never executes it. Models without the grant (the default, and every
small model) get packaged recipes only. This is the hardware story told the
one permitted way: the code never branches on device or tier; the per-model
budget record decides whether plan authoring is offered, the same way it
already decides rounds and tools. A 24 GB Mac and a 128 GB Studio run the
identical pipeline; the Studio's bigger chat model has earned a wider budget
on the bench, and its Stack profile has more roles resident so steps admit
sooner. Recipes are the floor that makes the smallest machine fully capable.

## The step vocabulary

A recipe is steps with typed inputs, outputs, and dependencies. The
vocabulary is closed and small; a new kind of step is a spec change, not a
package's invention:

- `text`: one bounded model call (a role, a prompt template from the
  package, named context inputs, a typed output). Runs under the same
  safety and output-gate machinery as a turn's answer.
- `media`: one Stack generator job (image, video, music; quality
  fast/everyday/best from the recipe or the person's settings), through the
  existing job API, admitted by the governor.
- `tool`: one existing package tool call, through the policy node,
  identical to a turn's tool step.
- `assemble`: a deterministic function the package ships (compose the PDF,
  lay out the booklet). No model, no network.
- `gate`: the output-safety pass over an artifact, mandatory before any
  artifact reaches the thread. The runner inserts one per artifact whether
  or not the recipe declares it; a recipe cannot opt out (safety is
  non-removable architecture, SAFETY.md).

Steps declare dependencies; the runner executes ready steps as the governor
admits them. On a p16 machine that serializes naturally because only one
engine fits; on a p128 it overlaps. Same code, no tier check.

## The project record and the runner

The project record is a shared spec shape (goes through `commons` spec
first, then the hub, then the robot, per the org rule): id, type (the
package), the filled recipe, per-step state (pending, running, done, failed,
skipped), artifacts (id, kind, path, the gate's verdict), provenance (who
asked, which thread, which turn), clock stamps, and a terminal state (done,
failed, cancelled). Durable rows: a restart resumes unfinished projects from
the last completed step (every step is idempotent or re-runnable by
declaration; a `media` step that finished keeps its artifact).

The runner is Home host machinery: it walks the dependency graph, runs each
step through the machinery that step kind names, enforces per-step deadlines
and a per-project ceiling (steps, wall time, generator jobs) from the
recipe's declared bounds, and never invents a step. A failed step fails
honestly: the project posts what finished and what did not, in plain words,
and offers retry of the failed step, never a silent partial success. Cancel
is a first-class action from the thread and from a project list surface.

## What the person sees

The starting turn replies immediately with what was started, the plan in one
sentence, and a rough duration. Progress appears in the thread as the
existing tool-event/status surface, not as chat messages ("page 3 of 8").
Completion posts the artifact into the thread and sends a notification per
NOTIFICATIONS.md. A running project survives the person closing the app;
they come back to the finished book. Voice gets the same contract: the
spoken reply is the acknowledgment, the artifact lands on screens.

## Safety, permissions, privacy

Every `text` and `media` step runs the same input constraints and output
gate a turn does; the mandatory `gate` step per artifact means a child's
coloring book is checked as a whole artifact, not just as streamed text.
Child profiles: a project type's manifest declares its child availability
like any package; a child's project runs with the child's restrictions on
every step. Compute is the household's own machine, so there is no metered
cost, but a project occupies generator roles; the governor's admission is
what keeps a child's eight-image job from starving the household's chat, and
a per-person concurrent-project cap (a setting, default small) keeps it
fair. Privacy: nothing leaves the house, same as every path. A project
started from an incognito thread is allowed, because its artifact is the
point and is durably wanted, but the project's provenance then records the
person and no thread, and its steps' prompts are not retained beyond the
run (the incognito boundary design, 2026-09-26, defines the retention rule
this references).

## What this is not

Not multi-agent: one model authors or fills a plan, deterministic code runs
it, per ARCH-AGENT-01's standing scope. Not a goal loop: the plan is fixed
when the project starts; the model is not consulted between steps except
inside a declared `text` step. Not a second turn pipeline: the turn's nodes
are untouched, and `start_project` is an ordinary tool. Not a workflow
engine for its own sake: no branching, no conditions, no loops in recipes
until a shipped package demonstrates the need in a design pass.

## Build order

Chunked items land in BACKLOG.md under "Projects" (all M unless noted):

- PROJECT-SPEC-01: the project record and recipe/step schemas in `commons`
  spec, with round-trip fixtures. First, per the spec-first rule.
- PROJECT-RUN-01: the runner and the project rows in Home, `text` and
  `assemble` steps only, resumable, with the mandatory gate.
- PROJECT-START-01: the `start_project` tool, policy classification,
  the starting turn's reply shape, progress and completion in the thread.
- PROJECT-MEDIA-01: the `media` step over the Stack job API. Blocked on the
  image role having one implemented, verified model (today both catalog
  entries are `implemented: false`; this design does not pretend otherwise).
- PROJECT-PACK-01: the first real package, the coloring book, as the
  proving recipe (S once the above exist).
- PROJECT-PLAN-01 (L, later): the `plan_authoring` budget grant and
  model-authored recipes, only after packaged recipes are in family use and
  a bench measures a candidate model's plan validity rate.

Dependencies to name honestly: PROJECT-MEDIA-01 needs the Stack image role
proven (a stack item, not ours); nothing else here waits on it, and
PROJECT-PACK-01 can prove the runner with a text-only project (a bedtime
storybook without pictures) if imaging lags.
