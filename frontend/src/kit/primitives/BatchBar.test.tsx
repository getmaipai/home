import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";

afterEach(cleanup);

describe("BatchBar", () => {
  test("names the number selected", () => {
    const { getByText } = render(
      <BatchBar count={3} onExit={() => {}}>
        <button type="button">Remove selected</button>
      </BatchBar>,
    );
    expect(getByText("3 selected")).toBeTruthy();
  });

  test("Done exits select mode", () => {
    const onExit = mock(() => {});
    const { getByRole } = render(
      <BatchBar count={0} onExit={onExit}>
        <button type="button">Remove selected</button>
      </BatchBar>,
    );
    fireEvent.click(getByRole("button", { name: "Done" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("renders the caller's batch actions, not a fixed set", () => {
    const { getByRole } = render(
      <BatchBar count={2} onExit={() => {}}>
        <button type="button">Archive selected</button>
      </BatchBar>,
    );
    expect(getByRole("button", { name: "Archive selected" })).toBeTruthy();
  });
});

describe("SelectModeToggle", () => {
  test("calls onClick with its own label", () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<SelectModeToggle label="Select people" onClick={onClick} />);
    fireEvent.click(getByRole("button", { name: "Select people" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
