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

test("repairs.still_open is the declared adult reminder type", () => {
  expect(getNotificationType("repairs.still_open")).toEqual({
    id: "repairs.still_open",
    level: "time_sensitive",
    audience: "adults",
    template: "Still not fixed: {title}",
    configurable: true,
    defaultChannels: ["in_app"],
    toast: true,
  });
});

test("file.shared_with_you is a passive, configurable, person-audience notice matching memory.updated's posture", () => {
  const type = getNotificationType("file.shared_with_you");
  expect(type).toBeDefined();
  expect(type?.level).toBe("passive");
  expect(type?.audience).toBe("person");
  expect(type?.configurable).toBe(true);
  expect(type?.defaultChannels).toEqual(["in_app"]);
  expect(type?.toast).toBe(false);
  const rendered = type!.template.replace("{fromDisplayName}", "Lucia").replace("{kindPhrase}", "a photo");
  expect(rendered).toBe("Lucia shared a photo with you.");
  expect(rendered).not.toContain("{");
});

test("file.shared_with_household is a passive, configurable, household-audience notice", () => {
  const type = getNotificationType("file.shared_with_household");
  expect(type).toBeDefined();
  expect(type?.level).toBe("passive");
  expect(type?.audience).toBe("household");
  expect(type?.configurable).toBe(true);
  expect(type?.defaultChannels).toEqual(["in_app"]);
  expect(type?.toast).toBe(false);
  const rendered = type!.template.replace("{fromDisplayName}", "Lucia").replace("{kindPhrase}", "a video");
  expect(rendered).toBe("Lucia shared a video with the household.");
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
      privacy: true,
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

  test("a channel declared by the spec is retained by the Home notification registry", () => {
    registerPackageNotificationTypes({
      id: "test-robot-pkg",
      notifications: [{ id: "test-robot-pkg.arrived", level: "passive", audience: "person", template: "Arrived", configurable: true, default_channels: ["in_app", "robot"] }],
    });
    expect(getNotificationType("test-robot-pkg.arrived")?.defaultChannels).toEqual(["in_app", "robot"]);
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

test("notification declarations preserve privacy and default absent privacy to private", () => {
  registerPackageNotificationTypes({
    id: "test-privacy-pkg",
    notifications: [
      { id: "test-privacy-pkg.private", level: "time_sensitive", audience: "person", template: "Secret", configurable: true, default_channels: ["in_app", "robot"] },
      { id: "test-privacy-pkg.public", level: "time_sensitive", audience: "person", template: "Public", configurable: true, default_channels: ["in_app", "robot"], privacy: false },
    ],
  });
  expect(getNotificationType("test-privacy-pkg.private")?.privacy).toBe(true);
  expect(getNotificationType("test-privacy-pkg.public")?.privacy).toBe(false);
  expect(getNotificationType("test-privacy-pkg.private")?.defaultChannels).toEqual(["in_app", "robot"]);
});
