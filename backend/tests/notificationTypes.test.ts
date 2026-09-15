import { describe, expect, test } from "bun:test";
import { getNotificationType, registerPackageNotificationTypes } from "@/lib/notificationTypes";

test("child.worrying_conversation is an adult-only, non-configurable notice with one safe template slot", () => {
  const type = getNotificationType("child.worrying_conversation");
  expect(type).toBeDefined();
  expect(type?.level).toBe("time_sensitive");
  expect(type?.audience).toBe("adults");
  expect(type?.configurable).toBe(false);
  expect(type?.defaultChannels).toEqual(["in_app", "telegram"]);
  expect(type?.toast).toBe(true);
  const rendered = type!.template.replace("{childName}", "Bramble");
  expect(rendered).toBe("Bramble had a conversation that seemed to weigh on them. A check-in may help.");
  expect(rendered).not.toContain("{");
});

describe("registerPackageNotificationTypes", () => {
  test("a package's declared type becomes real and dispatchable", () => {
    registerPackageNotificationTypes({
      id: "test-weather-pkg",
      notifications: [
        {
          id: "test-weather-pkg.severe_alert",
          level: "immediate",
          audience: "household",
          template: "Severe weather: {summary}",
          configurable: true,
          default_channels: ["in_app"],
        },
      ],
    });
    expect(getNotificationType("test-weather-pkg.severe_alert")).toEqual({
      id: "test-weather-pkg.severe_alert",
      level: "immediate",
      audience: "household",
      template: "Severe weather: {summary}",
      configurable: true,
      defaultChannels: ["in_app"],
      toast: true,
    });
  });

  test("a package cannot shadow a core type's id", () => {
    registerPackageNotificationTypes({
      id: "test-imposter-pkg",
      notifications: [
        {
          id: "safety.flagged_turn",
          level: "passive",
          audience: "person",
          template: "nothing to see here",
          configurable: true,
          default_channels: ["in_app"],
        },
      ],
    });
    expect(getNotificationType("safety.flagged_turn")?.configurable).toBe(false);
  });

  test("a package with no notifications declared is a no-op", () => {
    expect(() => registerPackageNotificationTypes({ id: "test-quiet-pkg" })).not.toThrow();
  });

  test("re-registering the same id twice does not overwrite the first registration", () => {
    registerPackageNotificationTypes({
      id: "test-idempotent-pkg",
      notifications: [
        {
          id: "test-idempotent-pkg.first",
          level: "passive",
          audience: "person",
          template: "first",
          configurable: true,
          default_channels: ["in_app"],
        },
      ],
    });
    registerPackageNotificationTypes({
      id: "test-idempotent-pkg",
      notifications: [
        {
          id: "test-idempotent-pkg.first",
          level: "immediate",
          audience: "adults",
          template: "second",
          configurable: false,
          default_channels: ["in_app", "telegram"],
        },
      ],
    });
    expect(getNotificationType("test-idempotent-pkg.first")?.template).toBe("first");
  });
});
