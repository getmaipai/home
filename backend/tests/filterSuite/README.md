# Filter suite

This suite runs recorded examples through the current protection functions using a small test adapter. It checks requests, released items, and filtered lists for reply, spoken, search, news, library, picture, clip, song, central policy, and coding surfaces.

Add a case in `cases.ts` using text already asserted by an existing safety test. Include that test path in `from`, choose the correct surface and point, and record the expected held or released result. When a check has no switch-off witness, add a case for that check instead of removing it from the registry.

Every production row that removes or replaces a protection must pass this suite before the check is removed. The recorded SafeSearch, spoken-grain, and topic-default cases have no overrides; OVERRIDES-01 adds override cases beside them.

Run from `backend/` with `MAIPAI_TEST_NO_PORTS=1 bun run test:filter-suite`.

## Checks not reached

`NOT_PURE` is empty. Every listed check is directly callable with small values and does not require a database or model to make the decision. Some checks may consult settings internally; the exercised default behavior is the same as the existing pure function's live default.

## The door

The door (`backend/src/lib/filter/`, FILTER-DOOR-01) is the production front. `door.test.ts` here runs the mappable recorded cases through it and the rest stay on their direct checks. CONTENT-POLICY-02 to 04 and FILTER-MEDIA-01 move callers onto the door and extend the mapping.
