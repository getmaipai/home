# Web sources are one household setting

Accepted 2026-10-12 (owner's ruling, question wizard). Owner-approved: 2026-10-12.

`search.web_sources` is declared household scope in the spec. Only an admin sets it, and there is no per-person
override, whatever the person's age band. The age-band rules are unchanged: a child or teen reaches SearXNG only,
ddgs stays closed for minors and guests, and the adult-site host list and output gate stay fixed.

## Supersedes

- WEBSOURCES-OWNER-01 (BACKLOG): its role widening applied to `changeWebSources`, which is removed. The sibling
  self-edit role fixes for site blocks stay.
- The DDGS-LIVE-01 paragraph in `docs/dev.md`, which described the per-person `changeWebSources` path.
- Rule 0 of `docs/design/RULES.md`, where "the sources a kid or teen gets" was listed as overridable for one person.
