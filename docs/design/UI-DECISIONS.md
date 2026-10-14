# UI decisions

This file is the precondition of KIT-ALERT-01, KIT-CAROUSEL-01 and KIT-TOUR-01. A part may be added to the kit only with a row here.

| Part | Decision | Why no existing kit, shadcn or Kibo UI part does the job | Registry or library | Version |
|---|---|---|---|---|
| `alert` | Jesse, 2026-10-13 | The kit has no `alert.tsx` today. The install plan identifies no existing kit part for warnings and errors on the Finish setting up on the computer page, the search-down banner and Repairs warnings. | shadcn registry | Not stated in the source plan. |
| `carousel` | Jesse, 2026-10-13 | The kit has no carousel. The install hero slides need autoplay, so the plan selects the shadcn Carousel on Embla with `embla-carousel-autoplay`. | shadcn registry, Embla, `embla-carousel-autoplay` | Not stated in the source plan. |
| `tour` | Jesse, 2026-10-13 | The shadcn registry had no tour or coachmark part when checked on 2026-10-13. The plan says Kibo UI was not checked. React Joyride is the compared library that passes render props so the kit can draw the tooltip with its Card, Button and Progress parts. | React Joyride | 3.2.0 (2026-07-09) |
