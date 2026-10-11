import { describe, expect, test } from "bun:test";
import { serviceId, serviceComponent } from "@/lib/serviceComponent";

describe("serviceComponent", () => {
  test("lowercases the host", () => {
    expect(serviceId("Example.COM")).toBe("example-com");
  });
  test("collapses a run of odd characters into one hyphen", () => {
    expect(serviceId("a  ::  b")).toBe("a-b");
  });
  test("strips leading and trailing hyphens", () => {
    expect(serviceId("..host..")).toBe("host");
  });
  test("falls back to unknown when nothing is left", () => {
    expect(serviceId("...")).toBe("unknown");
  });
  test("cuts the id to 64 characters", () => {
    expect(serviceId("a".repeat(100))).toHaveLength(64);
  });
  test("prefixes the component with service:", () => {
    expect(serviceComponent("Example.com")).toBe("service:example-com");
  });
});
