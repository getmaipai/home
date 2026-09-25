import { expect } from "bun:test";

export function expectHomeTablesWithoutDemoOrActions(minimum = 1): void {
  expect(document.body.textContent).not.toContain("Employee Data Table");
  const tables = Array.from(document.querySelectorAll('[data-slot="table"]'));
  expect(tables.length).toBeGreaterThanOrEqual(minimum);
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('[data-slot="table-head"]')).map((head) => head.textContent?.trim());
    expect(headers).not.toContain("Action");
  }
}
