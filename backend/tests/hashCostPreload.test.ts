import { expect, test } from "bun:test";

function parameters(hash: string): { memoryCost: number; timeCost: number } {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=\d+\$/.exec(hash);
  if (!match) throw new Error(`unexpected Argon2id hash prefix: ${hash.split("$").slice(0, 4).join("$")}`);
  return { memoryCost: Number(match[1]), timeCost: Number(match[2]) };
}

function restoreRealHash(previous: string | undefined): void {
  if (previous === undefined) delete process.env.MAIPAI_TEST_REAL_HASH;
  else process.env.MAIPAI_TEST_REAL_HASH = previous;
}

test("Argon2id hashing uses the cheap preload cost by default and verifies", async () => {
  const previous = process.env.MAIPAI_TEST_REAL_HASH;
  delete process.env.MAIPAI_TEST_REAL_HASH;
  try {
    const hash = await Bun.password.hash("x", { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
    expect(parameters(hash)).toEqual({ memoryCost: 8, timeCost: 1 });
    expect(await Bun.password.verify("x", hash)).toBe(true);
  } finally {
    restoreRealHash(previous);
  }
});

test("MAIPAI_TEST_REAL_HASH preserves the requested production Argon2id cost", async () => {
  const previous = process.env.MAIPAI_TEST_REAL_HASH;
  process.env.MAIPAI_TEST_REAL_HASH = "1";
  try {
    const hash = await Bun.password.hash("x", { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
    expect(parameters(hash)).toEqual({ memoryCost: 65536, timeCost: 3 });
  } finally {
    restoreRealHash(previous);
  }
});
