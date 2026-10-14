import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NewPersonForm } from "@/apps/people/NewPersonForm";
import { creatableRoles, serverRoleToRoleAdmin } from "@/apps/people/roles";
import type { Role } from "@/lib/api";

afterEach(cleanup);
function renderForm(actorRole: Role, onSubmit = mock(() => {})) {
  return { ...render(<NewPersonForm actorRole={actorRole} onSubmit={onSubmit} submitLabel="Add" busy={false} error={null} />), onSubmit };
}

describe("NewPersonForm", () => {
  test("owner role shows Admin checked and disabled and it cannot be unchecked by click or keyboard", () => {
    const view = renderForm("owner");
    fireEvent.click(view.getByRole("combobox", { name: "Role" }));
    fireEvent.click(view.getByRole("option", { name: "Owner" }));
    const admin = view.getByRole("checkbox", { name: "Admin" });
    expect(admin).toBeChecked();
    expect(admin).toBeDisabled();
    fireEvent.click(admin);
    fireEvent.keyDown(admin, { key: " " });
    expect(admin).toBeChecked();
    expect(admin).toHaveAccessibleDescription("The owner is always an admin.");
  });
  test("adult plus Admin submits server role admin; adult alone submits adult", () => {
    for (const [checked, expected] of [[true, "admin"], [false, "adult"]] as const) {
      const view = renderForm("owner");
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Avery" } });
      const admin = view.getByRole("checkbox", { name: "Admin" });
      if (checked) fireEvent.click(admin);
      fireEvent.submit(view.getByLabelText("Name").closest("form")!);
      expect(view.onSubmit).toHaveBeenCalledWith({ displayName: "Avery", role: expected, secret: "" });
      view.unmount();
    }
  });
  test("an admin actor cannot tick Admin", () => {
    const view = renderForm("admin");
    const admin = view.getByRole("checkbox", { name: "Admin" });
    expect(admin).toBeDisabled();
    fireEvent.click(admin);
    expect(admin).not.toBeChecked();
  });
  test("role choices match creatableRoles for owner and admin actors", () => {
    for (const actorRole of ["owner", "admin"] as const) {
      const view = renderForm(actorRole);
      fireEvent.click(view.getByRole("combobox", { name: "Role" }));
      const choices = view.getAllByRole("option").map((option) => option.textContent);
      const expected = [...new Set(creatableRoles(actorRole).map((role) => serverRoleToRoleAdmin(role).role))]
        .map((role) => ({ owner: "Owner", adult: "Adult", teen: "Teen", child: "Child", guest: "Guest" }[role]));
      expect(choices).toEqual(expected);
      view.unmount();
    }
  });

  test("empty name shows the fix-saying field error and does not submit", () => {
    const view = renderForm("owner");
    const name = view.getByLabelText("Name");
    fireEvent.blur(name);
    expect(view.getByRole("alert").textContent).toBe("Type a name for this person.");
    fireEvent.submit(name.closest("form")!);
    expect(view.onSubmit).not.toHaveBeenCalled();
  });

  test("UsersSection imports NewPersonForm for its add form", () => expect(readFileSync(new URL("../settings/UsersSection.tsx", import.meta.url), "utf8")).toContain('import { NewPersonForm, type NewPersonValues } from "@/apps/people/NewPersonForm"'));
});
