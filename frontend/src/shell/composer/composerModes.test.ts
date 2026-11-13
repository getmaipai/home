import { expect, test } from "bun:test";
import { composerHostFor, type ComposerModesResponse } from "@/shell/composer/composerModes";

const response: ComposerModesResponse = {
  band: "adult",
  modes: [{
    id: "picture", label: "Picture", icon: "image", route: "/apps/image/create", engine: "image", placeholder: "Describe it", references: [],
    chips: [{ id: "shape", label: "Shape", group: "Settings", icon: "crop", default: "square", options: [{ value: "square", label: "Square" }] }],
    presets: { label: "Presets", chips: [{ id: "template", label: "Templates", default: "", options: [{ value: "cat", label: "Cat", text: "A cat" }] }] },
    tools: [], primary: { label: "Make picture" }, quality: null, availability: "ready", disabledReason: null,
  }, { id: "ask", label: "Ask", icon: "message-circle", route: null, engine: null, placeholder: "Ask anything", references: [], chips: [], presets: null, tools: [], primary: { label: "Send" }, quality: null, availability: null, disabledReason: null }],
};

test("Create host maps chip icons and its template presets into the kit composer", () => {
  const destinations: string[] = [];
  const host = composerHostFor(response, "/apps/image/create", (to) => destinations.push(to));
  expect(host?.modes).toHaveLength(2);
  expect(host?.presets?.chips[0]?.options).toEqual([{ value: "cat", label: "Cat" }]);
  host?.presets?.chips[0]?.onValueChange("cat");
  expect(destinations).toEqual(["/apps/image/create?prompt=A+cat"]);
});
