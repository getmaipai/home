import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RouteSkeleton } from "@/kit/primitives/RouteSkeleton";

afterEach(cleanup);

describe("RouteSkeleton", () => {
  test("announces loading, never a blank screen", () => {
    const { getByRole } = render(<RouteSkeleton />);
    expect(getByRole("status", { name: "Loading" })).toBeTruthy();
  });
});
