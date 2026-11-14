import { describe, expect, test } from "bun:test";
import { i18n } from "@lingui/core";
import { appendToQueue, clearPlayNext, clearUpcoming, insertNext, moveUpcoming, paneModel, playlistIdOf, playlistSongs, queuePlaylistName, removeUpcoming, sourceLabelOf, type Track } from "./musicQueue";
import { createMusicPane, isMusicTab, QUEUE_TAB, RECENT_TAB } from "./musicPane";
import { saveQueueAsPlaylist } from "./musicQueueSave";
import { playedAgo } from "./MusicQueuePane.helpers";

if (!i18n.locale) { i18n.load("en", {}); i18n.activate("en"); }
const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key, songId: `song-${key}` });
const keys = (list: readonly Track[]) => list.map((one) => one.key);
const queue = ["a", "b", "c", "d", "e"].map(t);

describe("source label", () => {
  test("names the source, else Your songs", () => {
    expect(sourceLabelOf({ name: "Late night focus" })).toBe("Late night focus");
    expect(sourceLabelOf({ name: "   " })).toBe("Your songs");
    expect(sourceLabelOf(null)).toBe("Your songs");
    expect(sourceLabelOf(undefined, "Tus canciones")).toBe("Tus canciones");
  });
});

describe("tiers", () => {
  test("Now playing, Play next, then Next up", () => {
    const m = paneModel(queue, 1, ["d"]);
    expect(m.nowPlaying?.key).toBe("b");
    expect(keys(m.playNext)).toEqual(["d"]);
    expect(keys(m.nextUp)).toEqual(["c", "e"]);
  });
  test("an empty queue has nothing playing", () => {
    expect(paneModel([], -1, [])).toEqual({ nowPlaying: null, playNext: [], nextUp: [] });
  });
  test("a played song named in manual is not shown", () => {
    expect(keys(paneModel(queue, 2, ["a"]).playNext)).toEqual([]);
  });
  test("Play next lands right after the song playing and after earlier Play next songs", () => {
    const one = insertNext(queue, 0, [], t("z"));
    expect(keys(one.queue)).toEqual(["a", "z", "b", "c", "d", "e"]);
    const two = insertNext(one.queue, one.index, one.manual, t("y"));
    expect(keys(two.queue)).toEqual(["a", "z", "y", "b", "c", "d", "e"]);
    expect(two.manual).toEqual(["z", "y"]);
    expect(keys(paneModel(two.queue, two.index, two.manual).playNext)).toEqual(["z", "y"]);
  });
  test("Play next on a song already queued moves it, and on the playing song does nothing", () => {
    const moved = insertNext(queue, 0, [], t("d"));
    expect(keys(moved.queue)).toEqual(["a", "d", "b", "c", "e"]);
    expect(keys(insertNext(queue, 0, [], t("a")).queue)).toEqual(keys(queue));
  });
  test("Play next counts only upcoming Play next songs when played ones are still named", () => {
    const edit = insertNext(queue, 2, ["a"], t("z"));
    expect(keys(edit.queue)).toEqual(["a", "b", "c", "z", "d", "e"]);
  });
  test("Add to queue goes to the end in Next up", () => {
    const edit = appendToQueue(queue, 1, ["c"], t("z"));
    expect(keys(edit.queue)).toEqual(["a", "b", "c", "d", "e", "z"]);
    expect(edit.index).toBe(1);
    expect(keys(paneModel(edit.queue, edit.index, edit.manual).nextUp)).toEqual(["d", "e", "z"]);
  });
  test("Add to queue on a song already queued moves it to the end and out of Play next", () => {
    const edit = appendToQueue(queue, 0, ["b"], t("b"));
    expect(keys(edit.queue)).toEqual(["a", "c", "d", "e", "b"]);
    expect(edit.manual).toEqual([]);
  });
});

describe("remove and clear", () => {
  test("remove takes an upcoming song out and leaves the playing and played ones", () => {
    expect(keys(removeUpcoming(queue, 1, [], "d").queue)).toEqual(["a", "b", "c", "e"]);
    expect(keys(removeUpcoming(queue, 1, [], "b").queue)).toEqual(keys(queue));
    expect(keys(removeUpcoming(queue, 1, [], "a").queue)).toEqual(keys(queue));
  });
  test("removing before the playing song never moves the index", () => {
    expect(removeUpcoming(queue, 2, [], "d").index).toBe(2);
  });
  test("clear drops what comes after the playing song", () => {
    const edit = clearUpcoming(queue, 2, ["d"]);
    expect(keys(edit.queue)).toEqual(["a", "b", "c"]);
    expect(edit.manual).toEqual([]);
  });
  test("clear Play next leaves Next up", () => {
    const edit = clearPlayNext(queue, 0, ["b", "c"]);
    expect(keys(edit.queue)).toEqual(["a", "d", "e"]);
    expect(edit.manual).toEqual([]);
  });
});

describe("reorder", () => {
  test("moves a song before another inside Next up", () => {
    const edit = moveUpcoming(queue, 0, [], "e", "b");
    expect(keys(edit.queue)).toEqual(["a", "e", "b", "c", "d"]);
  });
  test("moves a song to the end", () => {
    expect(keys(moveUpcoming(queue, 0, [], "b", null).queue)).toEqual(["a", "c", "d", "e", "b"]);
  });
  test("never moves the playing or played songs, and ignores a song that is not upcoming", () => {
    expect(keys(moveUpcoming(queue, 2, [], "a", "d").queue)).toEqual(keys(queue));
    expect(keys(moveUpcoming(queue, 2, [], "c", "e").queue)).toEqual(keys(queue));
    expect(keys(moveUpcoming(queue, 0, [], "b", "zzz").queue)).toEqual(keys(queue));
    expect(keys(moveUpcoming(queue, 0, [], "b", "b").queue)).toEqual(keys(queue));
  });
  test("the playing song keeps playing: its index follows it", () => {
    expect(moveUpcoming(queue, 1, [], "e", "c").index).toBe(1);
  });
  test("a song dropped inside Play next joins it; dropped below it, leaves it", () => {
    const into = moveUpcoming(queue, 0, ["b", "c"], "e", "c");
    expect(keys(into.queue)).toEqual(["a", "b", "e", "c", "d"]);
    expect(into.manual).toEqual(["b", "e", "c"]);
    const out = moveUpcoming(queue, 0, ["b", "c"], "b", "e");
    expect(keys(out.queue)).toEqual(["a", "c", "d", "b", "e"]);
    expect(out.manual).toEqual(["c"]);
  });
  test("a song dropped on the line between the tiers stays in its own tier", () => {
    // Play next is b, c. Dragging d up to sit before d's old neighbour (the line) leaves it in Next up.
    const nextUp = moveUpcoming(queue, 0, ["b", "c"], "e", "d");
    expect(nextUp.manual).toEqual(["b", "c"]);
    // Dragging c (Play next) to the same line keeps it in Play next.
    const hand = moveUpcoming(queue, 0, ["b", "c"], "b", "d");
    expect(hand.manual).toEqual(["c", "b"]);
    expect(keys(hand.queue)).toEqual(["a", "c", "b", "d", "e"]);
  });
});

describe("save as playlist", () => {
  const song = (key: string): Track => ({ key, url: "/x", title: key, songId: `s-${key}` });
  test("the name is the source then the date", () => {
    expect(queuePlaylistName({ name: "Road trip" }, new Date(2026, 10, 14))).toBe("Road trip 2026-11-14");
    expect(queuePlaylistName(null, new Date(2026, 0, 5))).toBe("Your songs 2026-01-05");
  });
  test("songs are the playing one and what follows, once each", () => {
    const list = [song("a"), song("b"), song("c"), song("b")];
    expect(keys(playlistSongs(list, 1))).toEqual(["b", "c"]);
  });
  test("a sound has no playlist id; a song uses its song id", () => {
    expect(playlistIdOf({ key: "sound-1", url: "/s", title: "s" })).toBeNull();
    expect(playlistIdOf(song("a"))).toBe("s-a");
    expect(playlistIdOf({ key: "file-1", url: "/f", title: "f" })).toBe("file-1");
  });
  test("makes the playlist then adds each song in order", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const send = (async (path: string, init?: RequestInit) => { calls.push({ path, body: JSON.parse(String(init?.body)) }); return { id: "pl1", title: "Road trip 2026-11-14" }; }) as never;
    const done = await saveQueueAsPlaylist(send, [song("a"), song("b"), song("c")], 1, { name: "Road trip" }, new Date(2026, 10, 14));
    expect(calls[0]).toEqual({ path: "/api/media/collections", body: { kind: "playlist", title: "Road trip 2026-11-14" } });
    expect(calls.slice(1).map((one) => (one.body as { media_id: string }).media_id)).toEqual(["s-b", "s-c"]);
    expect(done).toEqual({ id: "pl1", title: "Road trip 2026-11-14", saved: 2, skipped: 0 });
  });
  test("counts songs the hub refuses and sounds, and keeps going", async () => {
    let n = 0;
    const send = (async (path: string) => { n += 1; if (path.endsWith("/items") && n === 3) throw new Error("no"); return { id: "pl1", title: "t" }; }) as never;
    const done = await saveQueueAsPlaylist(send, [song("a"), song("b"), song("c"), { key: "sound-1", url: "/s", title: "s" }], 0, null);
    expect(done.saved).toBe(2);
    expect(done.skipped).toBe(2);
  });
  test("a queue of only sounds says what to do and makes no playlist", async () => {
    let calls = 0;
    const send = (async () => { calls += 1; return { id: "x", title: "x" }; }) as never;
    await expect(saveQueueAsPlaylist(send, [{ key: "sound-1", url: "/s", title: "s" }], 0, null)).rejects.toThrow("Play a song first");
    expect(calls).toBe(0);
  });
});

describe("pane store", () => {
  test("a request opens a tab; asking again for the same tab is still a new ask", () => {
    const pane = createMusicPane();
    let heard = 0; pane.subscribe(() => { heard += 1; });
    pane.request(QUEUE_TAB);
    const first = pane.get().nonce;
    pane.request(QUEUE_TAB);
    expect(pane.get()).toMatchObject({ tab: QUEUE_TAB });
    expect(pane.get().nonce).toBe(first + 1);
    pane.select(RECENT_TAB);
    expect(pane.get().tab).toBe(RECENT_TAB);
    pane.release();
    expect(pane.get().tab).toBeNull();
    expect(heard).toBeGreaterThan(3);
  });
  test("hosted is set by the shell and only changes once", () => {
    const pane = createMusicPane();
    let heard = 0; pane.subscribe(() => { heard += 1; });
    pane.setHosted(true); pane.setHosted(true);
    expect(heard).toBe(1);
  });
  test("tab ids", () => { expect(isMusicTab(QUEUE_TAB)).toBe(true); expect(isMusicTab("history")).toBe(false); });
});

describe("played ago", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  test("minutes, hours, days", () => {
    expect(playedAgo("2026-11-14T11:59:50Z", now)).toBe("Played just now");
    expect(playedAgo("2026-11-14T11:30:00Z", now)).toBe("Played 30 min ago");
    expect(playedAgo("2026-11-14T09:00:00Z", now)).toBe("Played 3 h ago");
    expect(playedAgo("2026-11-12T12:00:00Z", now)).toBe("Played 2 d ago");
  });
});
