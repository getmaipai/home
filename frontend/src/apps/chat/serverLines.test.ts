// I18N-F2 (design note section 9 step 1): the hub's failure wording is data the client translates. Minor lines keep their own ids,
// are defined only in failureCopy.ts, and no child or teen catalog may override them.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { i18n } from "@lingui/core";
import { composerNotice, failureLine, failureMessage } from "@maipai/home-backend/src/lib/failureCopy";
import { activateLocale } from "@/i18n";
import { translateDescriptor, translateServerLine } from "@/apps/chat/serverLines";
import { parsePo } from "../../../scripts/po";

afterEach(async () => { await activateLocale("en-US"); });

describe("translateServerLine", () => {
  test("an adult line is Spanish in es and a minor line stays the minor catalog's English", async () => {
    await activateLocale("es");
    const adult = failureLine("busy", false);
    const minor = failureLine("busy", true);
    expect(translateServerLine(adult, false)).not.toBe(adult);
    expect(translateServerLine(minor, true)).toBe(minor);
    expect(translateDescriptor(failureMessage("busy", true))).toBe(minor);
  });

  test("text with no descriptor (an admin's own words) is shown as it came", async () => {
    await activateLocale("es");
    expect(translateServerLine("Back after the update.", false)).toBe("Back after the update.");
  });

  test("a minor never resolves to an adult id, and an adult never to a minor one", () => {
    // restarting has the same words for every band, so the band alone picks the id.
    const notice = composerNotice("unavailable", "restarting")!;
    expect(notice.adult).toBe(notice.child);
    const catalog = parsePo(readFileSync("src/locales/es/messages.po", "utf8"));
    const adultEntry = catalog.find((entry) => entry.id === "failure.composer.restarting.adult");
    const childEntry = catalog.find((entry) => entry.id === "failure.composer.restarting.child");
    expect(adultEntry).toBeTruthy();
    expect(childEntry?.msgstr).toBe("");
  });
});

describe("minor failure lines are defined only in failureCopy.ts", () => {
  test("every minor, teen and child failure id is empty in es and absent from every -x-child and -x-teen catalog", () => {
    const es = parsePo(readFileSync("src/locales/es/messages.po", "utf8")).filter((entry) => /^failure\..*\.(minor|teen|child)$/.test(entry.id));
    expect(es.length).toBeGreaterThan(20);
    expect(es.filter((entry) => entry.msgstr !== "")).toEqual([]);
    for (const dir of readdirSync("src/locales").filter((name) => /-x-(child|teen)$/.test(name))) {
      const path = `src/locales/${dir}/messages.po`;
      if (existsSync(path)) expect(parsePo(readFileSync(path, "utf8")).filter((entry) => entry.id.startsWith("failure."))).toEqual([]);
    }
  });

  test("the catalog lists failureCopy.ts as the only place a failure id comes from", () => {
    const refs = parsePo(readFileSync("src/locales/en-US/messages.po", "utf8")).filter((entry) => entry.id.startsWith("failure.")).flatMap((entry) => entry.refs.map((ref) => ref.replace(/:\d+$/, "")));
    expect(new Set(refs)).toEqual(new Set(["../backend/src/lib/failureCopy.ts"]));
  });
});

test("i18n is the shared instance", () => { expect(i18n.locale).toBeTruthy(); });
