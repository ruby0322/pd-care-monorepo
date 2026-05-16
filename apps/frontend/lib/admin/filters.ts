export type AdminActiveFilter = "all" | "active" | "inactive";
export type AdminRoleFilter = "all" | "patient" | "staff" | "admin";
export type AdminInfectionFilter = "all" | "suspected" | "normal";

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
  active: "all",
  createdFrom: "",
  createdTo: "",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  return value === "patient" || value === "staff" || value === "admin" ? value : "all";
}

function normalizeInfection(value: string | null): AdminInfectionFilter {
  return value === "suspected" || value === "normal" ? value : "all";
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
    active: normalizeActive(searchParams.get("active")),
    createdFrom: normalizeDate(searchParams.get("createdFrom")),
    createdTo: normalizeDate(searchParams.get("createdTo")),
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
  setEnumParam(params, "active", filters.active, EMPTY_PATIENT_FILTERS.active);
  setParam(params, "createdFrom", normalizeDate(filters.createdFrom));
  setParam(params, "createdTo", normalizeDate(filters.createdTo));
  return params;
}
