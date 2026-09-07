<!-- Store card. Dad test: grade 6, one action per step, no jargon. -->
# Web Search

Ask MaiPai to search the web and answer using what it finds.

## Try it

- "search the web for the tallest mountain"
- "search online for tonight's game score"
- "search the web for the closest pharmacy"

## What it needs

A SearXNG instance you run yourself, and its address entered under
Settings > Integrations > SearXNG URL. Web search is off until that's
set - MaiPai never scrapes a search engine directly. SearXNG is a free,
open-source search tool you can run at home; its own site walks through
setting one up.

## What it uses

Your search query goes to your own SearXNG instance, which is
configured to reach whichever search engines you choose. MaiPai never
talks to a search engine directly. The search results and your question
then go to the household's own local chat model to build an answer -
nothing leaves the house for that part.

## Offline

Needs your SearXNG instance to be reachable. Says so plainly if it
isn't set up or can't be reached.

## Keeping SearXNG up to date

An old SearXNG install can look like it's working - it answers, it just
stops finding anything. Search engines change their pages over time, and
an outdated SearXNG doesn't know how to read the new page anymore, so it
quietly comes back empty instead of showing an error. Update SearXNG
every so often to keep it working.

MaiPai checks your SearXNG instance once an hour and will show a Repairs
notice under Settings if it's unreachable, if the address looks wrong, or
if it's answering but not finding anything - the same "outdated install"
symptom above.

## License

AGPL-3.0. See the repository's LICENSE.
