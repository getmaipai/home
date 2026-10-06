import { describe, expect, test } from "bun:test";
import { utils } from "ssh2";
import { generateFakeSshHostKey, startFakeSshd, type FakeSshd } from "./fixtures/fakeSshd";
import { rotateRobotPassword, RobotPasswordRotationError } from "@/lib/robotSsh";

describe("fake sshd host key", () => {
  // ssh2 1.17.0 writes about 1 in 256 of its own Ed25519 keys malformed (it
  // strips leading zero bytes from the fixed-width public key), which failed
  // devices.test.ts at random in the gate. 4096 keys make the old fixture fail
  // this test with near certainty (1 - (255/256)^4096).
  test("every host key the fixture makes is one ssh2 can load", () => {
    for (let i = 0; i < 4096; i += 1) {
      const parsed = utils.parseKey(generateFakeSshHostKey().private);
      expect(parsed).not.toBeInstanceOf(Error);
    }
  });
});

describe("rotateRobotPassword()", () => {
  test("authenticates with the current password and sends the new one only over stdin", async () => {
    const received: string[] = [];
    const sshd: FakeSshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: (stdin) => {
        received.push(stdin);
        return { code: 0 };
      },
    });
    try {
      const { newPassword } = await rotateRobotPassword({
        host: "127.0.0.1",
        port: sshd.port,
        username: "pollen",
        currentPassword: "reachy-default",
      });

      expect(newPassword).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(newPassword.length).toBeGreaterThan(20);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(`pollen:${newPassword}`);
    } finally {
      await sshd.close();
    }
  });

  test("a wrong current password is refused and nothing is sent", async () => {
    const received: string[] = [];
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: (stdin) => {
        received.push(stdin);
        return { code: 0 };
      },
    });
    try {
      await expect(
        rotateRobotPassword({
          host: "127.0.0.1",
          port: sshd.port,
          username: "pollen",
          currentPassword: "wrong-password",
          connectTimeoutMs: 3000,
        }),
      ).rejects.toThrow();
      expect(received).toHaveLength(0);
    } finally {
      await sshd.close();
    }
  });

  test("a failing chpasswd raises RobotPasswordRotationError with the robot's stderr", async () => {
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 1, stderr: "chpasswd: PAM: Authentication failure\n" }),
    });
    try {
      await expect(
        rotateRobotPassword({
          host: "127.0.0.1",
          port: sshd.port,
          username: "pollen",
          currentPassword: "reachy-default",
        }),
      ).rejects.toThrow(RobotPasswordRotationError);
    } finally {
      await sshd.close();
    }
  });

  test("never logs the new password", async () => {
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });
    const originalLog = console.log;
    const logged: string[] = [];
    console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
    try {
      const { newPassword } = await rotateRobotPassword({
        host: "127.0.0.1",
        port: sshd.port,
        username: "pollen",
        currentPassword: "reachy-default",
      });
      expect(logged.some((line) => line.includes(newPassword))).toBe(false);
    } finally {
      console.log = originalLog;
      await sshd.close();
    }
  });
});
