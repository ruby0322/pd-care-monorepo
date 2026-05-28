export type AdminActiveFilter = "all" | "active" | "inactive";
export type AdminRoleFilter = "all" | "staff" | "admin";
export type AdminInfectionFilter = "all" | "suspected" | "normal";
export type AdminBindingFilter = "bound" | "all" | "unbound_only";
export type AdminAssignmentStatusFilter = "all" | "assigned" | "unassigned";

type SearchParamReader = {
  get(name: string): string | null;
};

type CommonFilters = {
  q: string;
  active: AdminActiveFilter;
  createdFrom: string;
  createdTo: string;
};

export type AdminUsersFilters = CommonFilters & {
  role: AdminRoleFilter;
};

export type AdminPatientsFilters = CommonFilters & {
  infection: AdminInfectionFilter;
  binding: AdminBindingFilter;
  page: number;
  pageSize: 20 | 50 | 100;
};

export type AdminAssignmentFilters = {
  q: string;
  binding: AdminBindingFilter;
  assignment: AdminAssignmentStatusFilter;
};

const EMPTY_USERS_FILTERS: AdminUsersFilters = {
  q: "",
  role: "all",
  active: "all",
  createdFrom: "",
  createdTo: "",
};

const EMPTY_PATIENT_FILTERS: AdminPatientsFilters = {
  q: "",
  infection: "all",
  binding: "bound",
  page: 1,
  pageSize: 20,
  active: "all",
  createdFrom: "",
  createdTo: "",
};

const EMPTY_ASSIGNMENT_FILTERS: AdminAssignmentFilters = {
  q: "",
  binding: "bound",
  assignment: "unassigned",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PAGE_SIZES = new Set<number>([20, 50, 100]);

function normalizeText(value: string | null): string {
  return (value ?? "").trim();
}

function normalizeDate(value: string | null): string {
  const normalized = normalizeText(value);
  return DATE_RE.test(normalized) ? normalized : "";
}

function normalizeActive(value: string | null): AdminActiveFilter {
  return value === "active" || value === "inactive" ? value : "all";
}

function normalizeRole(value: string | null): AdminRoleFilter {
  return value === "staff" || value === "admin" ? value : "all";
}

function normalizeInfection(value: string | null): AdminInfectionFilter {
  return value === "suspected" || value === "normal" ? value : "all";
}

function normalizeBinding(value: string | null): AdminBindingFilter {
  if (value === "all" || value === "unbound_only") {
    return value;
  }
  return "bound";
}

function normalizeAssignment(value: string | null): AdminAssignmentStatusFilter {
  if (value === "all" || value === "assigned") {
    return value;
  }
  return "unassigned";
}

function normalizePage(value: string | null): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function normalizePageSize(value: string | null): 20 | 50 | 100 {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (ALLOWED_PAGE_SIZES.has(parsed)) {
    return parsed as 20 | 50 | 100;
  }
  return 20;
}

function setParam(params: URLSearchParams, key: string, value: string): void {
  if (value) {
    params.set(key, value);
    return;
  }
  params.delete(key);
}

function setEnumParam<T extends string>(params: URLSearchParams, key: string, value: T, defaultValue: T): void {
  if (value !== defaultValue) {
    params.set(key, value);
    return;
  }
  params.delete(key);
}

export function parseUsersFilters(searchParams: SearchParamReader): AdminUsersFilters {
  return {
    q: normalizeText(searchParams.get("q")),
    role: normalizeRole(searchParams.get("role")),
    active: normalizeActive(searchParams.get("active")),
    createdFrom: normalizeDate(searchParams.get("createdFrom")),
    createdTo: normalizeDate(searchParams.get("createdTo")),
  };
}

export function parsePatientsFilters(searchParams: SearchParamReader): AdminPatientsFilters {
  return {
    q: normalizeText(searchParams.get("q")),
    infection: normalizeInfection(searchParams.get("infection")),
    binding: normalizeBinding(searchParams.get("binding")),
    page: normalizePage(searchParams.get("page")),
    pageSize: normalizePageSize(searchParams.get("pageSize")),
    active: normalizeActive(searchParams.get("active")),
    createdFrom: normalizeDate(searchParams.get("createdFrom")),
    createdTo: normalizeDate(searchParams.get("createdTo")),
  };
}

export function parseAssignmentFilters(searchParams: SearchParamReader): AdminAssignmentFilters {
  return {
    q: normalizeText(searchParams.get("q")),
    binding: normalizeBinding(searchParams.get("binding")),
    assignment: normalizeAssignment(searchParams.get("assignment")),
  };
}

export function usersFiltersToSearchParams(filters: AdminUsersFilters): URLSearchParams {
  const params = new URLSearchParams();
  setParam(params, "q", filters.q.trim());
  setEnumParam(params, "role", filters.role, EMPTY_USERS_FILTERS.role);
  setEnumParam(params, "active", filters.active, EMPTY_USERS_FILTERS.active);
  setParam(params, "createdFrom", normalizeDate(filters.createdFrom));
  setParam(params, "createdTo", normalizeDate(filters.createdTo));
  return params;
}

export function patientsFiltersToSearchParams(filters: AdminPatientsFilters): URLSearchParams {
  const params = new URLSearchParams();
  setParam(params, "q", filters.q.trim());
  setEnumParam(params, "infection", filters.infection, EMPTY_PATIENT_FILTERS.infection);
  setEnumParam(params, "binding", filters.binding, EMPTY_PATIENT_FILTERS.binding);
  setEnumParam(params, "pageSize", String(filters.pageSize), String(EMPTY_PATIENT_FILTERS.pageSize));
  setEnumParam(params, "page", String(filters.page), String(EMPTY_PATIENT_FILTERS.page));
  setEnumParam(params, "active", filters.active, EMPTY_PATIENT_FILTERS.active);
  setParam(params, "createdFrom", normalizeDate(filters.createdFrom));
  setParam(params, "createdTo", normalizeDate(filters.createdTo));
  return params;
}

export function assignmentFiltersToSearchParams(filters: AdminAssignmentFilters): URLSearchParams {
  const params = new URLSearchParams();
  setParam(params, "q", filters.q.trim());
  setEnumParam(params, "binding", filters.binding, EMPTY_ASSIGNMENT_FILTERS.binding);
  setEnumParam(params, "assignment", filters.assignment, EMPTY_ASSIGNMENT_FILTERS.assignment);
  return params;
}
