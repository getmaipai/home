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
  test("mismatched confirm passcode blocks submit and shows the fix; a match submits", () => {
    const view = render(<NewPersonForm actorRole="owner" fixedRole="owner" onSubmit={mock(() => {})} submitLabel="Add" busy={false} error={null} checkSecret />);
    const onSubmit = mock(() => {});
    view.rerender(<NewPersonForm actorRole="owner" fixedRole="owner" onSubmit={onSubmit} submitLabel="Add" busy={false} error={null} checkSecret />);
    const form = view.getByLabelText("Name").closest("form")!;
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Sage" } });
    fireEvent.change(view.getByLabelText("PIN or password"), { target: { value: "2468" } });
    fireEvent.change(view.getByLabelText("Confirm passcode"), { target: { value: "2469" } });
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("The two passcodes are different. Type the same passcode in both boxes.");
    fireEvent.change(view.getByLabelText("Confirm passcode"), { target: { value: "2468" } });
    expect(view.container.textContent).not.toContain("The two passcodes are different.");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledWith({ displayName: "Sage", role: "owner", secret: "2468" });
  });
  test("an empty confirm blocks submit when a passcode is typed; roles without a secret show no confirm box", () => {
    const view = renderForm("owner");
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Sage" } });
    fireEvent.change(view.getByLabelText("PIN or password"), { target: { value: "2468" } });
    fireEvent.submit(view.getByLabelText("Name").closest("form")!);
    expect(view.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("combobox", { name: "Role" }));
    fireEvent.click(view.getByRole("option", { name: "Child" }));
    expect(view.queryByLabelText("Confirm passcode")).toBeNull();
    fireEvent.submit(view.getByLabelText("Name").closest("form")!);
    expect(view.onSubmit).toHaveBeenCalledWith({ displayName: "Sage", role: "child" });
  });
  test("passcode boxes: neutral when empty, no early red, green on match, red on mismatch with sr status", () => {
    const view = render(<NewPersonForm actorRole="owner" fixedRole="owner" onSubmit={mock(() => {})} submitLabel="Add" busy={false} error={null} checkSecret />);
    const first = view.getByLabelText("PIN or password");
    const confirm = view.getByLabelText("Confirm passcode");
    const fix = "The two passcodes are different.";
    fireEvent.change(first, { target: { value: "2468" } });
    expect(confirm.getAttribute("aria-invalid")).toBe("false");
    expect(confirm.hasAttribute("data-valid")).toBe(false);
    fireEvent.change(confirm, { target: { value: "2" } });
    expect(confirm.getAttribute("aria-invalid")).toBe("false");
    expect(view.container.textContent).not.toContain(fix);
    fireEvent.change(confirm, { target: { value: "2469" } });
    expect(confirm.getAttribute("aria-invalid")).toBe("true");
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(view.container.textContent).toContain(fix);
    fireEvent.change(confirm, { target: { value: "2468" } });
    expect(confirm.getAttribute("data-valid")).toBe("true");
    expect(first.getAttribute("data-valid")).toBe("true");
    expect(confirm.getAttribute("aria-invalid")).toBe("false");
    expect(view.getByRole("status").textContent).toContain("Passcodes match");
    expect(view.container.textContent).not.toContain(fix);
  });
  test("a short confirm turns red once the box loses focus", () => {
    const view = render(<NewPersonForm actorRole="owner" fixedRole="owner" onSubmit={mock(() => {})} submitLabel="Add" busy={false} error={null} checkSecret />);
    fireEvent.change(view.getByLabelText("PIN or password"), { target: { value: "2468" } });
    const confirm = view.getByLabelText("Confirm passcode");
    fireEvent.change(confirm, { target: { value: "24" } });
    fireEvent.blur(confirm);
    expect(confirm.getAttribute("aria-invalid")).toBe("true");
  });
});
