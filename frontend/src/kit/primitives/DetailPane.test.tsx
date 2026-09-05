import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { DetailPane } from "@/kit/primitives/DetailPane";

afterEach(cleanup);

describe("DetailPane", () => {
  test("shows the title as a heading and renders its body", () => {
    const { getByRole, getByText } = render(
      <DetailPane title="Juniper" subtitle="Child profile">
        <p>Everything about Juniper.</p>
      </DetailPane>,
    );
    expect(getByRole("heading", { name: "Juniper" })).toBeInTheDocument();
    expect(getByText("Child profile")).toBeInTheDocument();
    expect(getByText("Everything about Juniper.")).toBeInTheDocument();
  });

  // docs/UI.md: on phone the right pane becomes a bottom sheet and
  // breadcrumbs become a back button, so a detail view always needs a
  // way out that is not the browser's Back.
  test("offers a way back only when the caller has somewhere to go back to", () => {
    const onClose = mock(() => {});
    const { queryByRole, rerender, getByRole } = render(
      <DetailPane title="Juniper">
        <p>Body</p>
      </DetailPane>,
    );
    expect(queryByRole("button", { name: "Back" })).toBeNull();

    rerender(
      <DetailPane title="Juniper" onClose={onClose}>
        <p>Body</p>
      </DetailPane>,
    );
    fireEvent.click(getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the back button can be renamed for what it actually does", () => {
    const { getByRole } = render(
      <DetailPane title="Juniper" onClose={() => {}} closeLabel="Close details">
        <p>Body</p>
      </DetailPane>,
    );
    expect(getByRole("button", { name: "Close details" })).toBeInTheDocument();
  });

  test("header actions stay reachable and are not swallowed by the body", () => {
    const onEdit = mock(() => {});
    const { getByRole } = render(
      <DetailPane
        title="Juniper"
        actions={
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        }
      >
        <p>Body</p>
      </DetailPane>,
    );
    const edit = getByRole("button", { name: "Edit" });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // Beside the heading, not inside the scrolling body.
    expect(edit.closest("div")?.parentElement?.contains(getByRole("heading", { name: "Juniper" }))).toBe(true);
  });

  // The body has to be the scroll container, not the page: in SplitView
  // the list beside it must stay put while the detail scrolls.
  test("the body scrolls on its own", () => {
    const { getByText } = render(
      <DetailPane title="Juniper">
        <p>Body</p>
      </DetailPane>,
    );
    const body = getByText("Body").parentElement;
    expect(body?.className).toContain("overflow-y-auto");
  });

  // WCAG 2.2 AA 2.1.1: a region that scrolls has to be reachable without
  // a mouse. Safari, which is what the iPhone and iPad PWA runs on, does
  // not focus keyboard-scrollable containers on its own the way Chrome
  // and Firefox now do (code review, 2026-09-05).
  test("a keyboard can reach the scrolling body", () => {
    const { getByText } = render(
      <DetailPane title="Juniper">
        <p>Body</p>
      </DetailPane>,
    );
    expect(getByText("Body").parentElement).toHaveAttribute("tabindex", "0");
  });
});
