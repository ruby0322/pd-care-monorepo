export type PatientLotCell =
  | { type: "patient"; patientIndex: number }
  | { type: "overflow"; count: number }
  | { type: "add" }
  | { type: "pad" };

export type PatientLotResult = {
  mode: "chip" | "square";
  cells: PatientLotCell[];
  visibleCount: number;
};

/** Desktop 2×4, mobile 1×4 — equal cells; always reserve "+" and optional "+n". */
export function buildPatientLot(patientCount: number, capacity: number): PatientLotResult {
  const safeCapacity = Math.max(2, capacity);
  // Always chip (avatar | name + sex badge) so dense lots stay readable and consistent with the pool.
  const mode = "chip" as const;
  const overflow = patientCount > safeCapacity - 1;
  const cells: PatientLotCell[] = [];

  if (overflow) {
    const visibleCount = safeCapacity - 2;
    for (let index = 0; index < visibleCount; index += 1) {
      cells.push({ type: "patient", patientIndex: index });
    }
    cells.push({ type: "overflow", count: patientCount - visibleCount });
    cells.push({ type: "add" });
    return { mode, cells, visibleCount };
  }

  for (let index = 0; index < patientCount; index += 1) {
    cells.push({ type: "patient", patientIndex: index });
  }
  cells.push({ type: "add" });
  while (cells.length < safeCapacity) {
    cells.push({ type: "pad" });
  }
  return { mode, cells, visibleCount: patientCount };
}

export function staffDisplayName(realName: string | null | undefined, displayName: string | null | undefined): string {
  const real = realName?.trim();
  if (real) {
    return real;
  }
  const line = displayName?.trim();
  if (line) {
    return line;
  }
  return "未命名人員";
}

export function genderBadgeLabel(gender: string | null | undefined): string {
  switch (gender) {
    case "male":
      return "男";
    case "female":
      return "女";
    case "other":
      return "其他";
    default:
      return "?";
  }
}

export function genderBadgeClass(gender: string | null | undefined): string {
  switch (gender) {
    case "male":
      return "bg-[#dbeafe] text-[#1e40af]";
    case "female":
      return "bg-[#fce7f3] text-[#9d174d]";
    case "other":
      return "bg-[#ede9fe] text-[#5b21b6]";
    default:
      return "bg-[#f4f4f5] text-[#52525b]";
  }
}
