# News

News reads the household's local shelf in chat and at `/apps/news`. Today, Following, Saved, Channel, Search and Story are available from the child role upward. My Mix requires the teen role. Guests cannot open the app or its data.

The seven pages are schema data (Search is reached from the search box, not from the tab strip). The hub supplies `story_feed` and `article` answer blocks; topics, sources, saved stories and recent searches use bare list rows. Today and My Mix pass the chosen topic chip to their data as the `topic` param (the answer_blocks node's `filter_state`); Search passes `q` and `topic` (`""` All, `__saved`, `__today`, or a topic id). `search_recent` and `search_recent_clear` are the two actions behind the search box; a child keeps no recents. `household-today` is declared for a later shared-screen surface and is used by no page. No browser fetches a publisher's pictures directly.

The News gear holds reading choices and the admin's News shelf matrix and feed boxes. The package declares `news.my_mix`, `news.reader_open` and `news.digest` in `config[]`, which Home's registry loads. These declarations are spec-owed until a shared spec tag carries them. Their consumers arrive in NEWS-04 through NEWS-06. A child's reader stays inside News and has no inferred interests.

Offline operation is degraded: the app can use stories already held by the hub; uncached pages and pictures need an internet connection. Saved-story pinning is supplied by the hub data slice.

The `headlines` widget keeps its existing fields. Its hero, data, surfaces, priority and role fields wait for HOME-PAGE-01. Key points, Listen and notifications arrive in later slices. The package adds no data routes or ranking code.

See [News](../../../docs/user/news.md), [the shelf](../../../docs/user/news-shelf.md) and [privacy](../../../docs/user/privacy.md) for the reading flow, feed controls and outbound requests.
