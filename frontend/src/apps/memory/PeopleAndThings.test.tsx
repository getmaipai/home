import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PeopleAndThings } from "@/apps/memory/PeopleAndThings";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Entity, Relationship, PersonRosterEntry } from "@/lib/api";

afterEach(cleanup);

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-a1b2c3",
    kind: "person",
    name: "Cosmo",
    aliases: [],
    description: null,
    place_kind: null,
    parent_id: null,
    account_person_id: null,
    source: "hub",
    confirmed_by_person_id: null,
    confirmed_at: null,
    pronouns: null,
    scope: "household",
    person: null,
    sensitive: false,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
    deleted_at: null,
    hlc: "1788000000000:0:test",
    ...overrides,
  };
}

function relationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: "rel-d4e5f6",
    type: "owns",
    from_id: "ent-owner",
    to_id: "ent-owned",
    status: "normal",
    valid_from: null,
    valid_to: null,
    expired_at: null,
    source: "stated",
    stated_by_person_id: "person-sage",
    confidence: null,
    confirmed_by_person_id: null,
    confirmed_at: null,
    evidence: [],
    scope: "household",
    person: null,
    sensitive: false,
    note: null,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
    deleted_at: null,
    hlc: "1788000000000:0:test",
    ...overrides,
  };
}

function person(overrides: Partial<PersonRosterEntry> = {}): PersonRosterEntry {
  return {
    id: "person-sage",
    display_name: "Sage",
    nickname: null,
    role: "adult",
    avatar_seed: "person-sage",
    source: "hub",
    local_only: false,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    ...overrides,
  };
}

function stubFetch(byPath: Record<string, unknown>, onRequest?: (url: string, init?: RequestInit) => void): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    onRequest?.(url, init);
    const candidates = Object.entries(byPath).filter(([path]) => url.includes(path));
    const match = candidates.sort((a, b) => b[0].length - a[0].length)[0];
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const value = match[1];
    if (typeof value === "number") return Promise.resolve(new Response("", { status: value }));
    return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function render(actorRole: PersonRosterEntry["role"] = "adult") {
  return renderWithQueryClient(<PeopleAndThings actorRole={actorRole} />);
}

describe("PeopleAndThings (lane 11 item 2)", () => {
  test("lists entities grouped by kind, each with its relationships in plain words", async () => {
    const bramble = entity({ id: "ent-bramble", kind: "person", name: "Bramble" });
    const juniper = entity({ id: "ent-juniper", kind: "pet", name: "Juniper" });
    const owns = relationship({ id: "rel-owns", type: "owns", from_id: "ent-bramble", to_id: "ent-juniper" });
    const ownedBy = relationship({ id: "rel-owned-by", type: "owned_by", from_id: "ent-juniper", to_id: "ent-bramble" });
    const restore = stubFetch({
      "/api/entities": [bramble, juniper],
      "/api/relationships": [owns, ownedBy],
      "/api/people": [],
    });
    try {
      const { findByText } = render();
      expect(await findByText("Bramble")).toBeInTheDocument();
      expect(await findByText("Juniper")).toBeInTheDocument();
      // Each direction's own row, both stored (createRelationship's
      // inverse write) - Bramble's row reads its own "owns" edge, and
      // Juniper's reads its own "owned_by" edge back, never the same
      // fact twice under one entity.
      expect(await findByText("owner of Juniper")).toBeInTheDocument();
      expect(await findByText("owned by Bramble")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // A symmetric type (sibling_of/partner_of/friend_of) stores ONE row,
  // not two - has to surface under BOTH entities' own rows or the second
  // party would never see it at all (relationshipLabels.ts's own header
  // on why symmetric types are matched from either from_id or to_id).
  test("a symmetric relationship (friend_of) shows under both entities from its one stored row", async () => {
    const atlas = entity({ id: "ent-atlas", kind: "person", name: "Atlas" });
    const iris = entity({ id: "ent-iris", kind: "person", name: "Iris" });
    const friendOf = relationship({ id: "rel-friend", type: "friend_of", from_id: "ent-atlas", to_id: "ent-iris" });
    const restore = stubFetch({ "/api/entities": [atlas, iris], "/api/relationships": [friendOf], "/api/people": [] });
    try {
      const { findAllByText } = render();
      const lines = await findAllByText("friend of Iris");
      // Atlas's own row: "friend of Iris". Iris's own row (matched via
      // to_id, since no reciprocal row exists for a symmetric type):
      // "friend of Atlas" - different text, so this only proves Atlas's
      // side rendered; the second assertion below covers Iris's.
      expect(lines.length).toBeGreaterThan(0);
      expect((await findAllByText("friend of Atlas")).length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  test("an inferred, unconfirmed relationship is marked, and Confirm shows for an adult", async () => {
    const marsh = entity({ id: "ent-marsh", kind: "person", name: "Marsh" });
    const sage = entity({ id: "ent-sage-person", kind: "person", name: "Sage" });
    const guess = relationship({ id: "rel-guess", type: "friend_of", from_id: "ent-marsh", to_id: "ent-sage-person", source: "inferred", confidence: 0.6 });
    const restore = stubFetch({ "/api/entities": [marsh, sage], "/api/relationships": [guess], "/api/people": [] });
    try {
      const { findAllByText } = render("adult");
      // friend_of is symmetric - one stored row surfaces under both
      // Marsh's and Sage's own rows (the test above's own reasoning),
      // so "Unconfirmed" and "Confirm" legitimately appear twice here.
      expect((await findAllByText("Unconfirmed")).length).toBeGreaterThan(0);
      expect((await findAllByText("Confirm")).length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  // Lane 12 item 2's own acceptance: hidden, not disabled, for a child -
  // the route itself would 403 them, but a tappable button into a wall
  // is worse than none. queryByText (not findByText) since the point is
  // that it never appears at all.
  test("Confirm is hidden, not shown-and-disabled, for a child", async () => {
    const marsh = entity({ id: "ent-marsh", kind: "person", name: "Marsh" });
    const sage = entity({ id: "ent-sage-person", kind: "person", name: "Sage" });
    const guess = relationship({ id: "rel-guess", type: "friend_of", from_id: "ent-marsh", to_id: "ent-sage-person", source: "inferred", confidence: 0.6 });
    const restore = stubFetch({ "/api/entities": [marsh, sage], "/api/relationships": [guess], "/api/people": [] });
    try {
      const { findAllByText, queryByText } = render("child");
      expect((await findAllByText("Unconfirmed")).length).toBeGreaterThan(0);
      expect(queryByText("Confirm")).toBeNull();
    } finally {
      restore();
    }
  });

  test("tapping Confirm sends exactly { confirm: true } and the mark clears", async () => {
    const marsh = entity({ id: "ent-marsh", kind: "person", name: "Marsh" });
    const sage = entity({ id: "ent-sage-person", kind: "person", name: "Sage" });
    const guess = relationship({ id: "rel-guess", type: "colleague_of", from_id: "ent-marsh", to_id: "ent-sage-person", source: "inferred", confidence: 0.6 });
    const confirmed: Relationship = { ...guess, confirmed_by_person_id: "person-sage", confirmed_at: "2026-09-14T00:00:00.000Z" };
    // Mutable, not the shared stubFetch helper: the row the list query
    // returns has to change (unconfirmed to confirmed) once the PATCH
    // lands, which a static byPath map can't express.
    let relationshipsState: Relationship[] = [guess];
    let sawBody: unknown;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "PATCH" && url.includes("/api/relationships/rel-guess")) {
        sawBody = JSON.parse(String(init.body));
        relationshipsState = [confirmed];
        return Promise.resolve(new Response(JSON.stringify(confirmed), { status: 200 }));
      }
      if (url.includes("/api/relationships")) return Promise.resolve(new Response(JSON.stringify(relationshipsState), { status: 200 }));
      if (url.includes("/api/entities")) return Promise.resolve(new Response(JSON.stringify([marsh, sage]), { status: 200 }));
      if (url.includes("/api/people")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findAllByText, queryByText } = render("adult");
      const [confirmButton] = await findAllByText("Confirm");
      fireEvent.click(confirmButton!);
      await waitFor(() => expect(queryByText("Unconfirmed")).toBeNull());
      expect(sawBody).toEqual({ confirm: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a 409 (nothing to confirm) leaves the mark in place and shows the error line", async () => {
    const marsh = entity({ id: "ent-marsh", kind: "person", name: "Marsh" });
    const sage = entity({ id: "ent-sage-person", kind: "person", name: "Sage" });
    const guess = relationship({ id: "rel-guess", type: "colleague_of", from_id: "ent-marsh", to_id: "ent-sage-person", source: "inferred", confidence: 0.6 });
    // The backend's own real 409 body (backend/src/lib/entities.ts's
    // confirmTransition()), not the shared stubFetch helper's numeric-
    // status shortcut (which sends an empty body): the point of this
    // test is that the SERVER'S OWN error text reaches the row, not a
    // generic fallback string.
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "PATCH" && url.includes("/api/relationships/rel-guess")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "already confirmed" }), { status: 409 }));
      }
      if (url.includes("/api/relationships")) return Promise.resolve(new Response(JSON.stringify([guess]), { status: 200 }));
      if (url.includes("/api/entities")) return Promise.resolve(new Response(JSON.stringify([marsh, sage]), { status: 200 }));
      if (url.includes("/api/people")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findAllByText, findByText } = render("adult");
      const [confirmButton] = await findAllByText("Confirm");
      fireEvent.click(confirmButton!);
      await findByText("already confirmed");
      expect((await findAllByText("Unconfirmed")).length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a stated relationship (the normal case) carries no Unconfirmed mark", async () => {
    const nova = entity({ id: "ent-nova", kind: "pet", name: "Nova" });
    const marlow = entity({ id: "ent-marlow", kind: "person", name: "Marlow" });
    const stated = relationship({ id: "rel-stated", type: "owned_by", from_id: "ent-nova", to_id: "ent-marlow", source: "stated" });
    const restore = stubFetch({ "/api/entities": [nova, marlow], "/api/relationships": [stated], "/api/people": [] });
    try {
      const { findByText, queryByText } = render();
      expect(await findByText("owned by Marlow")).toBeInTheDocument();
      expect(queryByText("Unconfirmed")).toBeNull();
    } finally {
      restore();
    }
  });

  test("household-scoped shows no extra label; person-scoped is labeled 'Just you'", async () => {
    const household = entity({ id: "ent-household-thing", kind: "thing", name: "The good couch", scope: "household" });
    const personScoped = entity({ id: "ent-private-thing", kind: "thing", name: "Sage's notebook", scope: "person", person: "person-sage" });
    const restore = stubFetch({ "/api/entities": [household, personScoped], "/api/relationships": [], "/api/people": [] });
    try {
      const { findByText, getByText } = render();
      await findByText("The good couch");
      // The subtitle is one combined line ("Thing · Just you"), not a
      // separate node - exact:false matches the substring.
      expect(getByText((_, el) => el?.textContent === "Thing · Just you")).toBeInTheDocument();
      // The household one gets no scope word at all - it's the default,
      // not something to call out on every single row.
      expect(getByText((_, el) => el?.textContent === "Thing")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("editing a name saves through PATCH /api/entities/:id", async () => {
    let patched: { url: string; body: unknown } | null = null;
    const cosmo = entity({ id: "ent-cosmo", kind: "person", name: "Cosmo" });
    const restore = stubFetch(
      {
        "/api/entities/ent-cosmo": { ...cosmo, name: "Cosmo Rivera" },
        "/api/entities": [cosmo],
        "/api/relationships": [],
        "/api/people": [],
      },
      (url, init) => {
        if (init?.method === "PATCH") patched = { url, body: JSON.parse(String(init.body)) };
      },
    );
    try {
      const { findByText, getByText, getByLabelText } = render();
      await findByText("Cosmo");
      fireEvent.click(getByText("Edit name"));
      const input = getByLabelText("Rename Cosmo");
      fireEvent.change(input, { target: { value: "Cosmo Rivera" } });
      fireEvent.click(getByText("Save"));
      await waitFor(() => expect(patched).not.toBeNull());
      expect(patched!.url).toContain("/api/entities/ent-cosmo");
      expect(patched!.body).toEqual({ name: "Cosmo Rivera" });
    } finally {
      restore();
    }
  });

  test("removing an entity, after confirming, deletes through DELETE /api/entities/:id", async () => {
    let deletedUrl: string | null = null;
    const willow = entity({ id: "ent-willow", kind: "pet", name: "Willow" });
    const restore = stubFetch(
      { "/api/entities/ent-willow": { id: "ent-willow" }, "/api/entities": [willow], "/api/relationships": [], "/api/people": [] },
      (url, init) => {
        if (init?.method === "DELETE") deletedUrl = url;
      },
    );
    try {
      const { findByText, getByText } = render();
      await findByText("Willow");
      fireEvent.click(getByText("Remove"));
      await findByText("Remove Willow?");
      fireEvent.click(getByText("Yes, remove"));
      await waitFor(() => expect(deletedUrl).not.toBeNull());
      expect(deletedUrl!).toContain("/api/entities/ent-willow");
    } finally {
      restore();
    }
  });

  // No bulk-delete route exists for entities (unlike /api/people/batch-
  // delete and /api/memory/batch-forget) - one DELETE per selected id,
  // still one confirmation, per the org's own batch-actions rule.
  test("batch delete: selecting several and confirming sends one DELETE per id", async () => {
    const deletedIds: string[] = [];
    const rivet = entity({ id: "ent-rivet", kind: "thing", name: "Rivet" });
    const quill = entity({ id: "ent-quill", kind: "thing", name: "Quill" });
    const restore = stubFetch(
      {
        "/api/entities/ent-rivet": { id: "ent-rivet" },
        "/api/entities/ent-quill": { id: "ent-quill" },
        "/api/entities": [rivet, quill],
        "/api/relationships": [],
        "/api/people": [],
      },
      (url, init) => {
        if (init?.method === "DELETE") deletedIds.push(url);
      },
    );
    try {
      const { findByText, getByText, getByLabelText } = render();
      await findByText("Rivet");
      fireEvent.click(getByText("Select"));
      fireEvent.click(getByLabelText("Select Rivet"));
      fireEvent.click(getByLabelText("Select Quill"));
      fireEvent.click(getByText("Remove selected"));
      await findByText("Remove 2 entries? This cannot be undone.");
      fireEvent.click(getByText("Yes, remove 2"));
      await waitFor(() => expect(deletedIds.length).toBe(2));
      expect(deletedIds.some((u) => u.includes("ent-rivet"))).toBe(true);
      expect(deletedIds.some((u) => u.includes("ent-quill"))).toBe(true);
    } finally {
      restore();
    }
  });

  test("creating a person, pet, place, organization or thing posts the right kind", async () => {
    let created: unknown = null;
    const restore = stubFetch(
      { "/api/entities": [], "/api/relationships": [], "/api/people": [] },
      (url, init) => {
        if (init?.method === "POST" && url.includes("/api/entities")) created = JSON.parse(String(init.body));
      },
    );
    try {
      const { findByText, getByText, getByPlaceholderText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      fireEvent.change(getByPlaceholderText("Name"), { target: { value: "Marsh" } });
      fireEvent.click(getByRole("button", { name: "Add" }));
      await waitFor(() => expect(created).not.toBeNull());
      expect(created).toMatchObject({ kind: "person", name: "Marsh", scope: "household" });
    } finally {
      restore();
    }
  });

  test("a place requires choosing map or area before it can be created", async () => {
    const restore = stubFetch({ "/api/entities": [], "/api/relationships": [], "/api/people": [] });
    try {
      const { findByText, getByText, getByLabelText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      fireEvent.click(getByLabelText("Kind"));
      fireEvent.click(getByRole("option", { name: "Place" }));
      expect(getByLabelText("What kind of place")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // The "optionally, one relationship to someone in the household" half:
  // the household member has no entity of their own yet (the normal
  // case - nothing auto-creates one), so this is a lookup-then-create,
  // then the relationship itself, all through existing routes.
  test("relating a new entity to a household member creates their entity once, then the relationship", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const sage = person({ id: "person-sage", display_name: "Sage" });
    const restore = stubFetch(
      {
        "/api/entities": [],
        "/api/relationships": [],
        "/api/people": [sage],
      },
      (url, init) => {
        if (init?.method === "POST") calls.push({ url, body: JSON.parse(String(init.body)) });
      },
    );
    // The stub above always answers /api/entities with [] regardless of
    // method - POST needs its own real Entity/Relationship shaped
    // response for the code under test to read `.id` off, so this test
    // overrides fetch directly rather than fighting stubFetch's static
    // table for a stateful sequence.
    const original = globalThis.fetch;
    let entityPosts = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST" && url.endsWith("/api/entities")) {
        entityPosts += 1;
        const body = JSON.parse(String(init.body)) as { name: string; kind: string };
        calls.push({ url, body });
        return Promise.resolve(Response.json(entity({ id: `ent-created-${entityPosts}`, name: body.name, kind: body.kind as Entity["kind"] }), { status: 201 }));
      }
      if (init?.method === "POST" && url.endsWith("/api/relationships")) {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body });
        return Promise.resolve(Response.json(relationship({ id: "rel-created", ...body }), { status: 201 }));
      }
      if (url.includes("/api/entities")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/relationships")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/people")) return Promise.resolve(Response.json([sage]));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByText, getByText, getByPlaceholderText, getByLabelText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      fireEvent.change(getByPlaceholderText("Name"), { target: { value: "Marsh" } });
      fireEvent.click(getByLabelText("Related to"));
      fireEvent.click(getByRole("option", { name: "Sage" }));
      await waitFor(() => expect(getByLabelText("How they're related")).toBeInTheDocument());
      fireEvent.click(getByRole("button", { name: "Add" }));
      await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/relationships"))).toBe(true));
      const entityCall = calls.find((c) => c.url.endsWith("/api/entities") && (c.body as { name: string }).name === "Marsh");
      const personEntityCall = calls.find((c) => c.url.endsWith("/api/entities") && (c.body as { account_person_id?: string }).account_person_id === "person-sage");
      const relCall = calls.find((c) => c.url.endsWith("/api/relationships"));
      expect(entityCall).toBeTruthy();
      expect(personEntityCall).toBeTruthy();
      expect(relCall).toBeTruthy();
    } finally {
      globalThis.fetch = original;
      restore();
    }
  });

  // A code review caught the form closing (and its error with it) in
  // the same tick the error was set - the entity saved, its relationship
  // didn't, and nobody could tell either had happened.
  test("when the entity saves but its relationship fails, the error stays visible and the form stays open", async () => {
    const sage = person({ id: "person-sage", display_name: "Sage" });
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST" && url.endsWith("/api/entities")) {
        const body = JSON.parse(String(init.body)) as { name: string; kind: string };
        return Promise.resolve(Response.json(entity({ id: "ent-created", name: body.name, kind: body.kind as Entity["kind"] }), { status: 201 }));
      }
      if (init?.method === "POST" && url.endsWith("/api/relationships")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "not allowed" }), { status: 400 }));
      }
      if (url.includes("/api/entities")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/relationships")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/people")) return Promise.resolve(Response.json([sage]));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByText, getByText, getByPlaceholderText, getByLabelText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      fireEvent.change(getByPlaceholderText("Name"), { target: { value: "Marsh" } });
      fireEvent.click(getByLabelText("Related to"));
      fireEvent.click(getByRole("option", { name: "Sage" }));
      await waitFor(() => expect(getByLabelText("How they're related")).toBeInTheDocument());
      fireEvent.click(getByRole("button", { name: "Add" }));
      await findByText(/Marsh was added, but the relationship couldn't be saved/);
      // Still open, not silently closed out from under the error.
      expect(getByPlaceholderText("Name")).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });

  // A code review caught NO_RELATION as "" colliding with Radix Select's
  // own "unset" detection (shouldShowPlaceholder) - the closed trigger
  // showed nothing at all instead of this sentinel's real label.
  test("the 'related to' picker shows its own label by default, not a blank trigger", async () => {
    const restore = stubFetch({ "/api/entities": [], "/api/relationships": [], "/api/people": [person()] });
    try {
      const { findByText, getByText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      expect(getByRole("combobox", { name: "Related to" })).toHaveTextContent("Not related to anyone");
    } finally {
      restore();
    }
  });

  // A code review caught relateTypeId surviving a kind change even
  // though the picker's own options are filtered by kind - a type
  // chosen under the old kind could silently submit under the new one,
  // never actually shown as the current selection.
  test("changing kind clears a previously chosen relationship type that no longer applies", async () => {
    const restore = stubFetch({ "/api/entities": [], "/api/relationships": [], "/api/people": [person()] });
    try {
      const { findByText, getByText, getByLabelText, getByRole } = render();
      await findByText("Nothing added yet.");
      fireEvent.click(getByText("Add"));
      fireEvent.click(getByLabelText("Related to"));
      fireEvent.click(getByRole("option", { name: "Sage" }));
      await waitFor(() => expect(getByRole("combobox", { name: "How they're related" })).toBeInTheDocument());
      fireEvent.click(getByRole("combobox", { name: "How they're related" }));
      fireEvent.click(getByRole("option", { name: "friend of" }));
      expect(getByRole("combobox", { name: "How they're related" })).toHaveTextContent("friend of");

      fireEvent.click(getByLabelText("Kind"));
      fireEvent.click(getByRole("option", { name: "Pet" }));

      // "friend of" only ever applied to a person->person edge - a pet
      // has no such option, so it must not still read that stale label.
      expect(getByRole("combobox", { name: "How they're related" })).not.toHaveTextContent("friend of");
    } finally {
      restore();
    }
  });
});
