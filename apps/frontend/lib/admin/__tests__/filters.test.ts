import { parseUsersFilters } from "@/lib/admin/filters";

describe("admin users filters", () => {
  test("coerces patient role query to all", () => {
    const params = new URLSearchParams("role=patient&q=Alice");

    const filters = parseUsersFilters(params);

    expect(filters.role).toBe("all");
    expect(filters.q).toBe("Alice");
  });
});
