# UI decisions

This file is the precondition of KIT-ALERT-01, KIT-CAROUSEL-01 and KIT-TOUR-01. A part may be added to the kit only with a row here.

The media cinema page tone was removed 2026-10-19 (Jesse); Music, Podcasts and Videos follow the user's selected theme.

| Part | Decision | Why no existing kit, shadcn or Kibo UI part does the job | Registry or library | Version |
| Media destination page | Jesse, 2026-10-20 | See [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md), section 12. | shadcn Tabs | ui-v0.5.306 |
|---|---|---|---|---|
| `alert` | Jesse, 2026-10-13 | No shipped kit part covers this use; see its source plan. | shadcn registry | Not stated in the source plan. |
| `carousel` | Jesse, 2026-10-13 | No shipped kit part covers this use; see its source plan. | shadcn registry, Embla, `embla-carousel-autoplay` | Not stated in the source plan. |
| `tour` | Jesse, 2026-10-13 | No shipped kit part covers this use; see its source plan. | React Joyride | 3.2.0 (2026-07-09) |
| StoryFeed | Jesse, 2026-10-17 (approved) | See [news-app-2026-10-17.md](news-app-2026-10-17.md) for details. | kit StoryFeed primitive | Not applicable |
| ArticleView | Jesse, 2026-10-17 (approved) | See [news-app-2026-10-17.md](news-app-2026-10-17.md) for details. | kit ArticleView primitive | Not applicable |
| `player` | MEDIA-PLAYER-01, 2026-10-17 (rule 9b reuse order, media design note section 6) | See the design note for details. | Media Chrome (Mux, MIT), `media-chrome/react` | 4.19.3 (2026-09-28) |
| `billboard` | MEDIA-PLAYER-01, 2026-10-17 | See the design note for details. | shadcn Carousel (existing), `embla-carousel-autoplay` | 8.6.0 (already pinned) |
| `SectionSidebar` | Jesse, 2026-10-18; NEWS-SIDEBAR-01 approved | See [news-app-2026-10-17.md](news-app-2026-10-17.md) for details. | Sidebar, Chip | ui-v0.5.279, ui-v0.5.280, ui-v0.5.285 |
| `StorageBar` (primitive) | LIBRARY-REVAMP-06, 2026-10-18 | See [library-2026-10-18.md](library-2026-10-18.md) for details. | kit `Progress` (pattern) | ui-v0.5.282 |
| `FileTile` (primitive) and `FileGrid` | LIBRARY-REVAMP-06, 2026-10-18 | See [library-2026-10-18.md](library-2026-10-18.md) for details. | kit `CardGrid` density | ui-v0.5.282 |
| `MediaViewer` (element) | LIBRARY-REVAMP-06, 2026-10-18 | See [library-2026-10-18.md](library-2026-10-18.md) for details. | `Player` (media-chrome), `Dialog`, `Sheet` | ui-v0.5.283 |
| Song card Edit panel | Jesse, 2026-10-19 | See the design note for details. | kit `MusicTrack`, `Input`, `Button` | ui-v0.5.302 |
| `ShareDialog` | LIBRARY-REVAMP-06, 2026-10-18 | See [library-2026-10-18.md](library-2026-10-18.md) for details. | ProjectShareDialog, DataTable | ui-v0.5.283 |
| `ImageGallery` layout row | Jesse, 2026-10-19 | See [media-detail-pages-2026-10-25.md](media-detail-pages-2026-10-25.md) for details. | assistant-ui gallery | ui-v0.5.292 |
| `CharacterHero` | Jesse, 2026-10-25; COMPANIONS-DOTS-01 approved | See [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md) for details. | kit parts above | ui-v0.5.332 pending |
| `CharacterTile` | Jesse, 2026-10-25; COMPANIONS-DOTS-01 approved | See [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md) for details. | kit parts above | ui-v0.5.332 pending |
| `ChatHeader` | Jesse, 2026-10-25; COMPANIONS-DOTS-01 approved | See [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md) for details. | kit parts above | ui-v0.5.332 pending |
| `ChatHeader` (assistant-ui Element gap) | Jesse, 2026-10-25; RULES.md rule 9 | See the design note for details. | kit parts above | ui-v0.5.332 pending |
| `media_card` | Jesse, 2026-10-25; chat-cards section 5 approved | See [chat-cards-2026-10-18.md](chat-cards-2026-10-18.md) for details. | `Card`, `Image`, `Button` primitives | No new library |
| `confirmation` | Jesse, 2026-10-25; chat-cards section 5 approved | See [chat-cards-2026-10-18.md](chat-cards-2026-10-18.md) for details. | `Alert` / task-card style row | No new library |
| `countdown` | Jesse, 2026-10-25; chat-cards section 5 approved | See [chat-cards-2026-10-18.md](chat-cards-2026-10-18.md) for details. | `schedule-card`, `number-ticker` | No new library |
| Elicitation-form fields | Jesse, 2026-10-25; FORM-CHAT-UI-01 approved | See [form-in-chat-2026-10-25.md](form-in-chat-2026-10-25.md) for details. | Input, Calendar, question-flow, option-list | No new dependency |
| `LyricsList` | Jesse, 2026-10-25; MEDIA-DETAIL-02 approved | See [media-detail-pages-2026-10-25.md](media-detail-pages-2026-10-25.md) for details. | MusicTrack lyrics, Button, empty state | No new library |
| Cover upload drop area | Jesse, 2026-10-25; MEDIA-DETAIL-02 approved | See [media-detail-pages-2026-10-25.md](media-detail-pages-2026-10-25.md) for details. | Dropzone, image-gallery | copied source |
