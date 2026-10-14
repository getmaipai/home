import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { useHeroCarouselVisible } from "./useHeroCarouselVisible";

function Visibility({ surface, starterReady, fullModelDownloading }: { surface: "hello" | "full-model-download" | "other"; starterReady: boolean; fullModelDownloading: boolean }) {
  const visible = useHeroCarouselVisible({ surface, starterReady, fullModelDownloading });
  return <span>{visible ? "visible" : "hidden"}</span>;
}

test("the visibility hook only allows the two intended download waits", () => {
  const view = render(<Visibility surface="hello" starterReady={false} fullModelDownloading={false} />);
  expect(view.getByText("visible")).toBeTruthy();
  view.rerender(<Visibility surface="hello" starterReady fullModelDownloading />);
  expect(view.getByText("hidden")).toBeTruthy();
  view.rerender(<Visibility surface="full-model-download" starterReady fullModelDownloading />);
  expect(view.getByText("visible")).toBeTruthy();
  view.rerender(<Visibility surface="other" starterReady={false} fullModelDownloading />);
  expect(view.getByText("hidden")).toBeTruthy();
});
