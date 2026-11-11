# Frontend route inventory

User-facing routes registered by the Home shell and package page JSON files. Dynamic route examples use persona roster names; package detail pages use their page IDs. Kit parts list the primary visible building blocks and are an inventory aid, not a complete component trace.

| Route path | Page component or package page | App | Kit parts it uses | Notes |
|---|---|---|---|---|
| `/` | DashboardPage | Home | Sidebar, Card, PromptBar | Signed in home |
| `/chat` | ChatPage | Chat | Thread, Composer | Chat |
| `/chat/projects` | ProjectsPage | Chat | Tabs, CardGrid | Chat projects |
| `/chat/projects/alfred` | ChatPage | Chat | Thread, Composer | Project conversation example |
| `/media` | MediaHomePage | Media | Billboard, MediaTileOverlay | Media home |
| `/media/search` | MediaSearchPage | Media | Search, CardGrid | Media search |
| `/files` | FilesPage | Library | FileGrid, Dialog | Library |
| `/people` | FamilyPage | Family | Avatar, CardGrid | Household people |
| `/people/sage` | PersonProfilePage | Family | Avatar, Tabs, Card | Person profile example |
| `/reminders` | RemindersPage | Reminders | List, Card | Reminders |
| `/apps/weather` | PackageAppPage | Weather | PackagePage, Card | Weather app |
| `/settings/profile` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings profile |
| `/settings/appearance` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings appearance |
| `/settings/chat` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings chat |
| `/setup/review` | SetupReviewPage | Setup | Card, Form | Setup review wizard |
| `/sign-in` | SignInPage | Sign-in | Form, Button | Signed out sign-in |
| `/activity` | ActivityPage | Activity | List, Card | Activity feed |
| `/status` | StatusPage | Status | StatusCard, Card | System status |
| `/repairs` | RepairsPage | Repairs | StatusCard, Card | Repairs |
| `/all-apps` | AllAppsPage | Apps | CardGrid, Card | Installed apps |
| `/notifications` | NotificationsPage | Notifications | List, Card | Notifications |
| `/search` | HeaderSearch | Search | Search, Command | Header search |
| `/storage` | StoragePage | Storage | Card, Table | Storage |
| `/updates` | UpdatesPage | Updates | StatusCard, Card | Updates |
| `/backups` | BackupsPage | Backups | Card, List | Backups |
| `/privacy` | PrivacyPage | Privacy | Card, List | Privacy |
| `/clock` | ClockPage | Clock | Card, Form | Clock |
| `/apps/books/audiobooks` | `books/audiobooks.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Audiobooks. |
| `/apps/books/books` | `books/books.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Books. |
| `/apps/books/detail` | `books/detail.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Detail. |
| `/apps/books/index` | `books/index.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Index. |
| `/apps/books/listen` | `books/listen.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Listen. |
| `/apps/books/read` | `books/read.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Read. |
| `/apps/books/series-detail` | `books/series-detail.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Series Detail. |
| `/apps/books/series` | `books/series.json` (PackageAppPage) | Books | PackagePage, Card, List | Package page: Series. |
| `/apps/music/album` | `music/album.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Album. |
| `/apps/music/albums` | `music/albums.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Albums. |
| `/apps/music/artist` | `music/artist.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Artist. |
| `/apps/music/artists` | `music/artists.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Artists. |
| `/apps/music/create` | `music/create.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Create. |
| `/apps/music/creations` | `music/creations.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Creations. |
| `/apps/music/edit` | `music/edit.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Edit. |
| `/apps/music/index` | `music/index.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Index. |
| `/apps/music/library` | `music/library.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Library. |
| `/apps/music/liked` | `music/liked.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Liked. |
| `/apps/music/make-album` | `music/make-album.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Make Album. |
| `/apps/music/make-band` | `music/make-band.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Make Band. |
| `/apps/music/make-song` | `music/make-song.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Make Song. |
| `/apps/music/make-style` | `music/make-style.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Make Style. |
| `/apps/music/play` | `music/play.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Play. |
| `/apps/music/playlist` | `music/playlist.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Playlist. |
| `/apps/music/playlists` | `music/playlists.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Playlists. |
| `/apps/music/radio` | `music/radio.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Radio. |
| `/apps/music/remix` | `music/remix.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Remix. |
| `/apps/music/search` | `music/search.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Search. |
| `/apps/music/songs` | `music/songs.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Songs. |
| `/apps/music/station` | `music/station.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Station. |
| `/apps/music/stems` | `music/stems.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Stems. |
| `/apps/music/studio` | `music/studio.json` (PackageAppPage) | Music | PackagePage, Card, List | Package page: Studio. |
| `/apps/news/channel` | `news/channel.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Channel. |
| `/apps/news/following` | `news/following.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Following. |
| `/apps/news/index` | `news/index.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Index. |
| `/apps/news/mix` | `news/mix.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Mix. |
| `/apps/news/saved` | `news/saved.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Saved. |
| `/apps/news/search` | `news/search.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Search. |
| `/apps/news/story` | `news/story.json` (PackageAppPage) | News | PackagePage, Card, List | Package page: Story. |
| `/apps/podcasts/episode` | `podcasts/episode.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Episode. |
| `/apps/podcasts/episodes` | `podcasts/episodes.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Episodes. |
| `/apps/podcasts/filters` | `podcasts/filters.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Filters. |
| `/apps/podcasts/index` | `podcasts/index.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Index. |
| `/apps/podcasts/new-show` | `podcasts/new-show.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: New Show. |
| `/apps/podcasts/play` | `podcasts/play.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Play. |
| `/apps/podcasts/queue` | `podcasts/queue.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Queue. |
| `/apps/podcasts/saved` | `podcasts/saved.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Saved. |
| `/apps/podcasts/search` | `podcasts/search.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Search. |
| `/apps/podcasts/show` | `podcasts/show.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Show. |
| `/apps/podcasts/shows` | `podcasts/shows.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Shows. |
| `/apps/podcasts/stats` | `podcasts/stats.json` (PackageAppPage) | Podcasts | PackagePage, Card, List | Package page: Stats. |
| `/apps/shows/film` | `shows/film.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Film. |
| `/apps/shows/films` | `shows/films.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Films. |
| `/apps/shows/index` | `shows/index.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Index. |
| `/apps/shows/show` | `shows/show.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Show. |
| `/apps/shows/shows` | `shows/shows.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Shows. |
| `/apps/shows/watch` | `shows/watch.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Watch. |
| `/apps/shows/watchlist` | `shows/watchlist.json` (PackageAppPage) | Shows | PackagePage, Card, List | Package page: Watchlist. |
| `/apps/videos/channel` | `videos/channel.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Channel. |
| `/apps/videos/clips-feed` | `videos/clips-feed.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Clips Feed. |
| `/apps/videos/clips` | `videos/clips.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Clips. |
| `/apps/videos/create` | `videos/create.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Create. |
| `/apps/videos/history` | `videos/history.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: History. |
| `/apps/videos/index` | `videos/index.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Index. |
| `/apps/videos/library` | `videos/library.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Library. |
| `/apps/videos/liked` | `videos/liked.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Liked. |
| `/apps/videos/playlist` | `videos/playlist.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Playlist. |
| `/apps/videos/playlists` | `videos/playlists.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Playlists. |
| `/apps/videos/search` | `videos/search.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Search. |
| `/apps/videos/studio` | `videos/studio.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Studio. |
| `/apps/videos/watch-later` | `videos/watch-later.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Watch Later. |
| `/apps/videos/watch` | `videos/watch.json` (PackageAppPage) | Videos | PackagePage, Card, List | Package page: Watch. |
| `/apps/weather/index` | `weather/index.json` (PackageAppPage) | Weather | PackagePage, Card, List | Package page: Index. |
| `/settings/settings` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings area: Settings. |

| `/memory` | MemoriesRedirect | Family | Card, List, Button | Shell route. |
| `/memories` | MemoriesRedirect | Family | Card, List, Button | Shell route. |
| `/storage/trash` | TrashPage | Storage | Card, List, Button | Shell route. |
| `/settings` | SettingsEntryRedirect | Settings | Card, List, Button | Shell route. |
| `/settings/home` | LegacySettingsRedirect | Settings | Card, List, Button | Shell route. |
| `/settings/account` | LegacySettingsRedirect | Settings | Card, List, Button | Shell route. |
| `/customize` | CustomizeRedirect | Settings | Card, List, Button | Shell route. |
| `/apps/music/like-this` | MusicLikeThisPage | Music | Card, List, Button | Shell route. |
| `/apps/news/discuss` | NewsDiscussPage | News | Card, List, Button | Shell route. |
| `/companions` | CompanionsPage | Companions | Card, List, Button | Shell route. |
| `/companions/create` | CompanionFlowPage | Companions | Card, List, Button | Shell route. |
| `/companions/alfred/create` | CompanionFlowPage | Companions | Card, List, Button | Shell route. |
| `/companions/alfred` | CompanionDetailPage | Companions | Card, List, Button | Shell route. |
| `/house` | HousePage | Family | Card, List, Button | Shell route. |
| `/performance` | PerformancePage | Status | Card, List, Button | Shell route. |
| `/trace/alfred` | TurnTracePage | Activity | Card, List, Button | Shell route. |
| `/commands` | CommandsPage | Settings | Card, List, Button | Shell route. |
| `/users` | UsersPage | Family | Card, List, Button | Shell route. |
| `/household` | Navigate to reminders | Reminders | Card, List, Button | Shell route. |
| `/household/coming-up` | Navigate to reminders | Reminders | Card, List, Button | Shell route. |
| `/reminders/coming-up` | Navigate to reminders | Reminders | Card, List, Button | Shell route. |
| `/dev/ui` | UiShowcasePage | Developer | Card, List, Button | Shell route. |
| `/mic-test` | MicTestPage | Setup | Card, List, Button | Shell route. |
| `/reference/alfred` | ReferencePage | References | Card, List, Button | Shell route. |
| `/wikipedia/alfred` | WikipediaPage | References | Card, List, Button | Shell route. |

| `/settings/voice` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Voice and robot. |
| `/settings/notifications` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Notifications. |
| `/settings/data` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Your data and apps. |
| `/settings/household` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Household and people. |
| `/settings/privacy` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Privacy and safety. |
| `/settings/ai` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: AI and models. |
| `/settings/media` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Pictures, videos and music. |
| `/settings/home-voice` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Voice. |
| `/settings/search` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Search and web. |
| `/settings/offline-data` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Offline data. |
| `/settings/apps` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Apps and devices. |
| `/settings/backups` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Backups, storage and updates. |
| `/settings/advanced` | SettingsAreaPage | Settings | SettingsShell, SettingsRenderer | Settings page: Advanced. |

Route manifest used by the scripted capture. `auth: none` means the signed-out screen; all other routes are captured as Sage.

```json
[
  {
    "slug": "home",
    "path": "/",
    "auth": "sage"
  },
  {
    "slug": "chat",
    "path": "/chat",
    "auth": "sage"
  },
  {
    "slug": "chat-projects",
    "path": "/chat/projects",
    "auth": "sage"
  },
  {
    "slug": "chat-projects-alfred",
    "path": "/chat/projects/alfred",
    "auth": "sage"
  },
  {
    "slug": "media",
    "path": "/media",
    "auth": "sage"
  },
  {
    "slug": "media-search",
    "path": "/media/search",
    "auth": "sage"
  },
  {
    "slug": "files",
    "path": "/files",
    "auth": "sage"
  },
  {
    "slug": "people",
    "path": "/people",
    "auth": "sage"
  },
  {
    "slug": "people-sage",
    "path": "/people/sage",
    "auth": "sage"
  },
  {
    "slug": "reminders",
    "path": "/reminders",
    "auth": "sage"
  },
  {
    "slug": "apps-weather",
    "path": "/apps/weather",
    "auth": "sage"
  },
  {
    "slug": "settings-profile",
    "path": "/settings/profile",
    "auth": "sage"
  },
  {
    "slug": "settings-appearance",
    "path": "/settings/appearance",
    "auth": "sage"
  },
  {
    "slug": "settings-chat",
    "path": "/settings/chat",
    "auth": "sage"
  },
  {
    "slug": "setup-review",
    "path": "/setup/review",
    "auth": "sage"
  },
  {
    "slug": "sign-in",
    "path": "/sign-in",
    "auth": "none"
  },
  {
    "slug": "activity",
    "path": "/activity",
    "auth": "sage"
  },
  {
    "slug": "status",
    "path": "/status",
    "auth": "sage"
  },
  {
    "slug": "repairs",
    "path": "/repairs",
    "auth": "sage"
  },
  {
    "slug": "all-apps",
    "path": "/all-apps",
    "auth": "sage"
  },
  {
    "slug": "notifications",
    "path": "/notifications",
    "auth": "sage"
  },
  {
    "slug": "search",
    "path": "/search",
    "auth": "sage"
  },
  {
    "slug": "storage",
    "path": "/storage",
    "auth": "sage"
  },
  {
    "slug": "updates",
    "path": "/updates",
    "auth": "sage"
  },
  {
    "slug": "backups",
    "path": "/backups",
    "auth": "sage"
  },
  {
    "slug": "privacy",
    "path": "/privacy",
    "auth": "sage"
  },
  {
    "slug": "clock",
    "path": "/clock",
    "auth": "sage"
  },
  {
    "slug": "apps-books-audiobooks",
    "path": "/apps/books/audiobooks",
    "auth": "sage"
  },
  {
    "slug": "apps-books-books",
    "path": "/apps/books/books",
    "auth": "sage"
  },
  {
    "slug": "apps-books-detail",
    "path": "/apps/books/detail",
    "auth": "sage"
  },
  {
    "slug": "apps-books-index",
    "path": "/apps/books/index",
    "auth": "sage"
  },
  {
    "slug": "apps-books-listen",
    "path": "/apps/books/listen",
    "auth": "sage"
  },
  {
    "slug": "apps-books-read",
    "path": "/apps/books/read",
    "auth": "sage"
  },
  {
    "slug": "apps-books-series-detail",
    "path": "/apps/books/series-detail",
    "auth": "sage"
  },
  {
    "slug": "apps-books-series",
    "path": "/apps/books/series",
    "auth": "sage"
  },
  {
    "slug": "apps-music-album",
    "path": "/apps/music/album",
    "auth": "sage"
  },
  {
    "slug": "apps-music-albums",
    "path": "/apps/music/albums",
    "auth": "sage"
  },
  {
    "slug": "apps-music-artist",
    "path": "/apps/music/artist",
    "auth": "sage"
  },
  {
    "slug": "apps-music-artists",
    "path": "/apps/music/artists",
    "auth": "sage"
  },
  {
    "slug": "apps-music-create",
    "path": "/apps/music/create",
    "auth": "sage"
  },
  {
    "slug": "apps-music-creations",
    "path": "/apps/music/creations",
    "auth": "sage"
  },
  {
    "slug": "apps-music-edit",
    "path": "/apps/music/edit",
    "auth": "sage"
  },
  {
    "slug": "apps-music-index",
    "path": "/apps/music/index",
    "auth": "sage"
  },
  {
    "slug": "apps-music-library",
    "path": "/apps/music/library",
    "auth": "sage"
  },
  {
    "slug": "apps-music-liked",
    "path": "/apps/music/liked",
    "auth": "sage"
  },
  {
    "slug": "apps-music-make-album",
    "path": "/apps/music/make-album",
    "auth": "sage"
  },
  {
    "slug": "apps-music-make-band",
    "path": "/apps/music/make-band",
    "auth": "sage"
  },
  {
    "slug": "apps-music-make-song",
    "path": "/apps/music/make-song",
    "auth": "sage"
  },
  {
    "slug": "apps-music-make-style",
    "path": "/apps/music/make-style",
    "auth": "sage"
  },
  {
    "slug": "apps-music-play",
    "path": "/apps/music/play",
    "auth": "sage"
  },
  {
    "slug": "apps-music-playlist",
    "path": "/apps/music/playlist",
    "auth": "sage"
  },
  {
    "slug": "apps-music-playlists",
    "path": "/apps/music/playlists",
    "auth": "sage"
  },
  {
    "slug": "apps-music-radio",
    "path": "/apps/music/radio",
    "auth": "sage"
  },
  {
    "slug": "apps-music-remix",
    "path": "/apps/music/remix",
    "auth": "sage"
  },
  {
    "slug": "apps-music-search",
    "path": "/apps/music/search",
    "auth": "sage"
  },
  {
    "slug": "apps-music-songs",
    "path": "/apps/music/songs",
    "auth": "sage"
  },
  {
    "slug": "apps-music-station",
    "path": "/apps/music/station",
    "auth": "sage"
  },
  {
    "slug": "apps-music-stems",
    "path": "/apps/music/stems",
    "auth": "sage"
  },
  {
    "slug": "apps-music-studio",
    "path": "/apps/music/studio",
    "auth": "sage"
  },
  {
    "slug": "apps-news-channel",
    "path": "/apps/news/channel",
    "auth": "sage"
  },
  {
    "slug": "apps-news-following",
    "path": "/apps/news/following",
    "auth": "sage"
  },
  {
    "slug": "apps-news-index",
    "path": "/apps/news/index",
    "auth": "sage"
  },
  {
    "slug": "apps-news-mix",
    "path": "/apps/news/mix",
    "auth": "sage"
  },
  {
    "slug": "apps-news-saved",
    "path": "/apps/news/saved",
    "auth": "sage"
  },
  {
    "slug": "apps-news-search",
    "path": "/apps/news/search",
    "auth": "sage"
  },
  {
    "slug": "apps-news-story",
    "path": "/apps/news/story",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-episode",
    "path": "/apps/podcasts/episode",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-episodes",
    "path": "/apps/podcasts/episodes",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-filters",
    "path": "/apps/podcasts/filters",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-index",
    "path": "/apps/podcasts/index",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-new-show",
    "path": "/apps/podcasts/new-show",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-play",
    "path": "/apps/podcasts/play",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-queue",
    "path": "/apps/podcasts/queue",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-saved",
    "path": "/apps/podcasts/saved",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-search",
    "path": "/apps/podcasts/search",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-show",
    "path": "/apps/podcasts/show",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-shows",
    "path": "/apps/podcasts/shows",
    "auth": "sage"
  },
  {
    "slug": "apps-podcasts-stats",
    "path": "/apps/podcasts/stats",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-film",
    "path": "/apps/shows/film",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-films",
    "path": "/apps/shows/films",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-index",
    "path": "/apps/shows/index",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-show",
    "path": "/apps/shows/show",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-shows",
    "path": "/apps/shows/shows",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-watch",
    "path": "/apps/shows/watch",
    "auth": "sage"
  },
  {
    "slug": "apps-shows-watchlist",
    "path": "/apps/shows/watchlist",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-channel",
    "path": "/apps/videos/channel",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-clips-feed",
    "path": "/apps/videos/clips-feed",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-clips",
    "path": "/apps/videos/clips",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-create",
    "path": "/apps/videos/create",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-history",
    "path": "/apps/videos/history",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-index",
    "path": "/apps/videos/index",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-library",
    "path": "/apps/videos/library",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-liked",
    "path": "/apps/videos/liked",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-playlist",
    "path": "/apps/videos/playlist",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-playlists",
    "path": "/apps/videos/playlists",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-search",
    "path": "/apps/videos/search",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-studio",
    "path": "/apps/videos/studio",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-watch-later",
    "path": "/apps/videos/watch-later",
    "auth": "sage"
  },
  {
    "slug": "apps-videos-watch",
    "path": "/apps/videos/watch",
    "auth": "sage"
  },
  {
    "slug": "apps-weather-index",
    "path": "/apps/weather/index",
    "auth": "sage"
  },
  {
    "slug": "settings-settings",
    "path": "/settings/settings",
    "auth": "sage"
  },
  {
    "slug": "memory",
    "path": "/memory",
    "auth": "sage"
  },
  {
    "slug": "memories",
    "path": "/memories",
    "auth": "sage"
  },
  {
    "slug": "storage-trash",
    "path": "/storage/trash",
    "auth": "sage"
  },
  {
    "slug": "settings",
    "path": "/settings",
    "auth": "sage"
  },
  {
    "slug": "settings-home",
    "path": "/settings/home",
    "auth": "sage"
  },
  {
    "slug": "settings-account",
    "path": "/settings/account",
    "auth": "sage"
  },
  {
    "slug": "customize",
    "path": "/customize",
    "auth": "sage"
  },
  {
    "slug": "apps-music-like-this",
    "path": "/apps/music/like-this",
    "auth": "sage"
  },
  {
    "slug": "apps-news-discuss",
    "path": "/apps/news/discuss",
    "auth": "sage"
  },
  {
    "slug": "companions",
    "path": "/companions",
    "auth": "sage"
  },
  {
    "slug": "companions-create",
    "path": "/companions/create",
    "auth": "sage"
  },
  {
    "slug": "companions-alfred-create",
    "path": "/companions/alfred/create",
    "auth": "sage"
  },
  {
    "slug": "companions-alfred",
    "path": "/companions/alfred",
    "auth": "sage"
  },
  {
    "slug": "house",
    "path": "/house",
    "auth": "sage"
  },
  {
    "slug": "performance",
    "path": "/performance",
    "auth": "sage"
  },
  {
    "slug": "trace-alfred",
    "path": "/trace/alfred",
    "auth": "sage"
  },
  {
    "slug": "commands",
    "path": "/commands",
    "auth": "sage"
  },
  {
    "slug": "users",
    "path": "/users",
    "auth": "sage"
  },
  {
    "slug": "household",
    "path": "/household",
    "auth": "sage"
  },
  {
    "slug": "household-coming-up",
    "path": "/household/coming-up",
    "auth": "sage"
  },
  {
    "slug": "reminders-coming-up",
    "path": "/reminders/coming-up",
    "auth": "sage"
  },
  {
    "slug": "dev-ui",
    "path": "/dev/ui",
    "auth": "sage"
  },
  {
    "slug": "mic-test",
    "path": "/mic-test",
    "auth": "sage"
  },
  {
    "slug": "reference-alfred",
    "path": "/reference/alfred",
    "auth": "sage"
  },
  {
    "slug": "wikipedia-alfred",
    "path": "/wikipedia/alfred",
    "auth": "sage"
  },
  {
    "slug": "companions-start",
    "path": "/companions/start",
    "auth": "sage"
  },
  {
    "slug": "companions-new",
    "path": "/companions/new",
    "auth": "sage"
  },
  {
    "slug": "settings-voice",
    "path": "/settings/voice",
    "auth": "sage"
  },
  {
    "slug": "settings-notifications",
    "path": "/settings/notifications",
    "auth": "sage"
  },
  {
    "slug": "settings-data",
    "path": "/settings/data",
    "auth": "sage"
  },
  {
    "slug": "settings-household",
    "path": "/settings/household",
    "auth": "sage"
  },
  {
    "slug": "settings-privacy",
    "path": "/settings/privacy",
    "auth": "sage"
  },
  {
    "slug": "settings-ai",
    "path": "/settings/ai",
    "auth": "sage"
  },
  {
    "slug": "settings-media",
    "path": "/settings/media",
    "auth": "sage"
  },
  {
    "slug": "settings-home-voice",
    "path": "/settings/home-voice",
    "auth": "sage"
  },
  {
    "slug": "settings-search",
    "path": "/settings/search",
    "auth": "sage"
  },
  {
    "slug": "settings-offline-data",
    "path": "/settings/offline-data",
    "auth": "sage"
  },
  {
    "slug": "settings-apps",
    "path": "/settings/apps",
    "auth": "sage"
  },
  {
    "slug": "settings-backups",
    "path": "/settings/backups",
    "auth": "sage"
  },
  {
    "slug": "settings-advanced",
    "path": "/settings/advanced",
    "auth": "sage"
  }
]
```
