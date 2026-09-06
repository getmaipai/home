import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Chip } from "@/kit/primitives/Chip";

afterEach(cleanup);

describe("Chip", () => {
  test("a non-interactive chip renders as plain content, not a button", () => {
    const { getByText, queryByRole } = render(<Chip>Sage</Chip>);
    expect(getByText("Sage")).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });

  test("a filter chip toggles selection on click", () => {
    const onClick = mock(() => {});
    const { getByRole } = render(
      <Chip selected={false} onClick={onClick}>
        Photos
      </Chip>,
    );
    const chip = getByRole("button", { name: "Photos" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a selected filter chip reports aria-pressed and shows a check", () => {
    const { getByRole, container } = render(
      <Chip selected onClick={() => {}}>
        Photos
      </Chip>,
    );
    expect(getByRole("button", { name: "Photos" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("svg")).toBeTruthy();
  });

  test("Enter and Space activate a filter chip the same as a click (it renders as a span, not a real button)", () => {
    const onClick = mock(() => {});
    const { getByRole } = render(
      <Chip onClick={onClick} selected={false}>
        Photos
      </Chip>,
    );
    const chip = getByRole("button", { name: "Photos" });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.keyDown(chip, { key: " " });
    fireEvent.keyDown(chip, { key: "Tab" });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("an input chip's remove button fires onRemove without triggering the chip's own onClick", () => {
    const onRemove = mock(() => {});
    const onClick = mock(() => {});
    const { getByRole } = render(
      <Chip onClick={onClick} onRemove={onRemove} removeLabel="Remove Sage">
        Sage
      </Chip>,
    );
    fireEvent.click(getByRole("button", { name: "Remove Sage" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
