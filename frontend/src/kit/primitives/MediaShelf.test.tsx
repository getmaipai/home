import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MediaShelf } from "@/kit/primitives/MediaShelf";

afterEach(cleanup);

interface Track {
  id: string;
  title: string;
}

const tracks: Track[] = [
  { id: "1", title: "Sprout" },
  { id: "2", title: "Tempo" },
];

describe("MediaShelf", () => {
  test("renders one tile per item under its heading", () => {
    const { getByRole, getByLabelText } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={(t) => <img src={`/${t.id}.png`} alt="" />}
        renderCaption={(t) => t.title}
        heading="Recently added"
      />,
    );
    expect(getByRole("heading", { name: "Recently added" })).toBeInTheDocument();
    expect(getByLabelText("Recently added").querySelectorAll("li")).toHaveLength(2);
  });

  test("the heading also names the rail, so it is not an unlabelled scroll region", () => {
    const { getByLabelText } = render(
      <MediaShelf items={tracks} getKey={(t) => t.id} renderItem={(t) => <span>{t.title}</span>} heading="Shows" />,
    );
    expect(getByLabelText("Shows").tagName).toBe("UL");
  });

  test("playing a tile reports its item", () => {
    const onSelect = mock((_t: Track) => {});
    const { getByRole } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={() => <img src="/x.png" alt="" />}
        getLabel={(t) => t.title}
        onSelect={onSelect}
        label="Music"
      />,
    );
    fireEvent.click(getByRole("button", { name: "Tempo" }));
    expect(onSelect.mock.calls[0]?.[0]).toEqual({ id: "2", title: "Tempo" });
  });

  // WCAG 2.2 AA 2.1.1: a region that scrolls has to be reachable without
  // a mouse. Interactive tiles are their own tab stops; a shelf of plain
  // artwork has none, so the rail itself takes one.
  test("a non-interactive rail is focusable; an interactive one is not a redundant tab stop", () => {
    const { getByLabelText, rerender } = render(
      <MediaShelf items={tracks} getKey={(t) => t.id} renderItem={(t) => <span>{t.title}</span>} label="Art" />,
    );
    expect(getByLabelText("Art")).toHaveAttribute("tabindex", "0");

    rerender(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={(t) => <span>{t.title}</span>}
        onSelect={() => {}}
        label="Art"
      />,
    );
    expect(getByLabelText("Art")).not.toHaveAttribute("tabindex");
  });

  test("the media box carries the declared aspect ratio and no fixed size", () => {
    const { getByLabelText } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={(t) => <img src={`/${t.id}.png`} alt={t.title} />}
        aspect="poster"
        label="Films"
      />,
    );
    const box = getByLabelText("Films").querySelector("li > div > div");
    expect(box?.className).toContain("aspect-[2/3]");
    // docs/UI.md: no fixed widths or heights on content.
    expect(box?.className).not.toMatch(/\b[wh]-\d+\b/);
  });

  test("the caption sits outside the aspect box so a long title cannot crop the art", () => {
    const { getByText } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={(t) => <img src={`/${t.id}.png`} alt="" />}
        renderCaption={(t) => t.title}
        aspect="square"
        label="Albums"
      />,
    );
    const caption = getByText("Sprout");
    expect(caption.closest("[class*='aspect-']")).toBeNull();
  });

  // Every finding below came from a code review, 2026-09-05.
  test("a selected tile is visibly selected, not only marked for assistive tech", () => {
    const { getByLabelText } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={(t) => <img src={`/${t.id}.png`} alt="" />}
        getLabel={(t) => t.title}
        onSelect={() => {}}
        isSelected={(t) => t.id === "2"}
        label="Music"
      />,
    );
    const [first, second] = Array.from(getByLabelText("Music").querySelectorAll("li"));
    // Card draws selection as a border color, which a borderless artwork
    // tile zeroes out; without its own treatment the selected tile was
    // pixel-identical to every other one.
    expect(second?.querySelector("[class~='ring-2']")).not.toBeNull();
    expect(first?.querySelector("[class~='ring-2']")).toBeNull();
  });

  test("the caption is not nested inside the tile button", () => {
    const { getByText } = render(
      <MediaShelf
        items={tracks}
        getKey={(t) => t.id}
        renderItem={() => <img src="/x.png" alt="" />}
        renderCaption={(t) => <a href={`/artist/${t.id}`}>{t.title}</a>}
        getLabel={(t) => t.title}
        onSelect={() => {}}
        label="Music"
      />,
    );
    // A link inside a button is keyboard-unreachable and invalid HTML.
    expect(getByText("Sprout").closest("button")).toBeNull();
  });

  test("the rail leaves room for a tile's focus ring to draw", () => {
    const { getByLabelText } = render(
      <MediaShelf items={tracks} getKey={(t) => t.id} renderItem={(t) => <span>{t.title}</span>} label="Art" />,
    );
    // `overflow-x-auto` clips vertically too, so a rail with no padding
    // shaves the top of the ring off.
    expect(getByLabelText("Art").className).not.toContain("p-0");
    expect(getByLabelText("Art").className).toMatch(/\bp-1\.5\b/);
  });

  test("shows the empty state, still under its heading", () => {
    const { getByRole, getByText, queryByLabelText } = render(
      <MediaShelf
        items={[]}
        getKey={(t: Track) => t.id}
        renderItem={(t: Track) => <span>{t.title}</span>}
        heading="Continue watching"
        emptyState={{ icon: "archive", text: "Nothing started yet" }}
      />,
    );
    expect(getByRole("heading", { name: "Continue watching" })).toBeInTheDocument();
    expect(getByText("Nothing started yet")).toBeInTheDocument();
    expect(queryByLabelText("Continue watching")).toBeNull();
  });
});
