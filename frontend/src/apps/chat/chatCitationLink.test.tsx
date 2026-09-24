import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createCitationComponents } from "@/apps/chat/chatCitationLink";

afterEach(cleanup);

describe("createCitationComponents", () => {
  test("a link that isn't a citation marker never opens in the current tab", () => {
    const { a: A } = createCitationComponents(undefined, () => {});
    const { getByRole } = render(<A href="https://example.com/page">the site</A>);
    const link = getByRole("link", { name: "the site" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});
