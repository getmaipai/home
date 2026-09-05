import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { AsyncState } from "@/kit/primitives/AsyncState";

afterEach(cleanup);

describe("AsyncState", () => {
  test("shows a loading skeleton while data is undefined", () => {
    const { getByRole } = render(
      <AsyncState data={undefined} onRetry={() => {}}>
        {() => <p>never rendered</p>}
      </AsyncState>,
    );
    expect(getByRole("status")).toBeTruthy();
  });

  test("shows the catalogue message and a retry button on error", () => {
    const onRetry = mock(() => {});
    const { getByText, getByRole } = render(
      <AsyncState data={undefined} error errorMessage="Couldn't connect. Check your internet connection." onRetry={onRetry}>
        {() => <p>never rendered</p>}
      </AsyncState>,
    );
    expect(getByText("Couldn't connect. Check your internet connection.")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("shows the empty state when data is null", () => {
    const { getByText } = render(
      <AsyncState data={null} onRetry={() => {}} emptyText="Nothing remembered yet.">
        {() => <p>never rendered</p>}
      </AsyncState>,
    );
    expect(getByText("Nothing remembered yet.")).toBeTruthy();
  });

  test("shows the empty state when the loaded data is itself empty", () => {
    const { getByText } = render(
      <AsyncState data={[]} onRetry={() => {}} isEmpty={(rows: unknown[]) => rows.length === 0} emptyText="Nothing here.">
        {() => <p>never rendered</p>}
      </AsyncState>,
    );
    expect(getByText("Nothing here.")).toBeTruthy();
  });

  test("renders the real content once data has loaded", () => {
    const { getByText, queryByRole } = render(
      <AsyncState data={["Nova"]} onRetry={() => {}}>
        {(rows) => <p>{rows.join(", ")}</p>}
      </AsyncState>,
    );
    expect(getByText("Nova")).toBeTruthy();
    expect(queryByRole("status")).toBeNull();
  });
});
