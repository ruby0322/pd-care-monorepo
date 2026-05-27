import { parsePatientsFilters, parseUsersFilters, patientsFiltersToSearchParams } from "@/lib/admin/filters";

describe("admin users filters", () => {
  test("coerces patient role query to all", () => {
    const params = new URLSearchParams("role=patient&q=Alice");

    const filters = parseUsersFilters(params);

    expect(filters.role).toBe("all");
    expect(filters.q).toBe("Alice");
  });
});

describe("admin patients filters", () => {
  test("defaults to page=1 and pageSize=20", () => {
    const params = new URLSearchParams();

    const filters = parsePatientsFilters(params);

    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(20);
    expect(filters.binding).toBe("bound");
  });

  test("coerces invalid page and pageSize", () => {
    const params = new URLSearchParams("page=0&pageSize=15&binding=all");

    const filters = parsePatientsFilters(params);

    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(20);
    expect(filters.binding).toBe("all");
  });

  test("serializes page and pageSize when non-default", () => {
    const params = patientsFiltersToSearchParams({
      q: "foo",
      infection: "all",
      binding: "unbound_only",
      page: 2,
      pageSize: 50,
      active: "all",
      createdFrom: "",
      createdTo: "",
    });

    expect(params.get("q")).toBe("foo");
    expect(params.get("binding")).toBe("unbound_only");
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
  });
});
