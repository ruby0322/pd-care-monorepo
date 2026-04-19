import { AIClassification, AIResult, Patient, PhotoRecord, Symptoms } from "./types";

function deterministicInt(seed: string, min: number, max: number): number {
  const sum = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return (sum % (max - min + 1)) + min;
}

function makeAIResult(id: string, classification: AIClassification): AIResult {
  if (classification === "rejected") {
    return {
      classification: "rejected",
      confidence: deterministicInt(id, 5, 28),
      accepted: false,
      rejectionReason: "照明不足，請確保充足光線後重新拍攝",
    };
  }
  return {
    classification,
    confidence:
      classification === "normal"
        ? deterministicInt(id, 83, 97)
        : deterministicInt(id, 71, 88),
    accepted: true,
  };
}

function makeRecord(id: string, daysAgo: number, classification: AIClassification, symptoms: Symptoms): PhotoRecord {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id,
    uploadedAt: date.toISOString(),
    aiResult: makeAIResult(id, classification),
    symptoms,
    photoUrl: undefined,
  };
}

export const MOCK_PATIENTS: Patient[] = [
  {
    id: "p001",
    caseNumber: "A1234567",
    name: "王大明",
    age: 62,
    gender: "male",
    lineUsername: "wang_daming",
    diagnosisDate: "2023-03-15T00:00:00.000Z",
    records: [
      makeRecord("r001a", 1, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001b", 4, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001c", 8, "suspected", { pain: true, discharge: true, cloudyDialysate: false }),
      makeRecord("r001d", 12, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001e", 16, "rejected", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001f", 20, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001g", 25, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r001h", 30, "suspected", { pain: true, discharge: false, cloudyDialysate: true }),
    ],
  },
  {
    id: "p002",
    caseNumber: "B2345678",
    name: "李淑芬",
    age: 55,
    gender: "female",
    lineUsername: "lee_shufen",
    diagnosisDate: "2022-07-20T00:00:00.000Z",
    records: [
      makeRecord("r002a", 2, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r002b", 6, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r002c", 10, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r002d", 14, "suspected", { pain: true, discharge: true, cloudyDialysate: true }),
      makeRecord("r002e", 18, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p003",
    caseNumber: "C3456789",
    name: "陳建國",
    age: 71,
    gender: "male",
    lineUsername: "chen_jianguo",
    diagnosisDate: "2021-11-05T00:00:00.000Z",
    records: [
      makeRecord("r003a", 3, "suspected", { pain: true, discharge: true, cloudyDialysate: false }),
      makeRecord("r003b", 7, "suspected", { pain: true, discharge: true, cloudyDialysate: true }),
      makeRecord("r003c", 11, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r003d", 15, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r003e", 19, "rejected", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r003f", 23, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p004",
    caseNumber: "D4567890",
    name: "張美惠",
    age: 48,
    gender: "female",
    lineUsername: "chang_meihui",
    diagnosisDate: "2024-01-10T00:00:00.000Z",
    records: [
      makeRecord("r004a", 1, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r004b", 5, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r004c", 9, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p005",
    caseNumber: "E5678901",
    name: "林志偉",
    age: 65,
    gender: "male",
    lineUsername: "lin_jhiwei",
    diagnosisDate: "2022-05-22T00:00:00.000Z",
    records: [
      makeRecord("r005a", 2, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r005b", 6, "suspected", { pain: true, discharge: false, cloudyDialysate: false }),
      makeRecord("r005c", 10, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r005d", 14, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r005e", 18, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r005f", 22, "rejected", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r005g", 26, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p006",
    caseNumber: "F6789012",
    name: "黃淑玲",
    age: 59,
    gender: "female",
    lineUsername: "huang_shuling",
    diagnosisDate: "2023-09-01T00:00:00.000Z",
    records: [
      makeRecord("r006a", 3, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r006b", 7, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r006c", 11, "suspected", { pain: false, discharge: true, cloudyDialysate: true }),
      makeRecord("r006d", 15, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p007",
    caseNumber: "G7890123",
    name: "吳俊賢",
    age: 44,
    gender: "male",
    lineUsername: "wu_junhsien",
    diagnosisDate: "2024-06-15T00:00:00.000Z",
    records: [
      makeRecord("r007a", 4, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r007b", 8, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r007c", 12, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r007d", 16, "rejected", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p008",
    caseNumber: "H8901234",
    name: "劉雅婷",
    age: 38,
    gender: "female",
    lineUsername: "liu_yating",
    diagnosisDate: "2024-03-20T00:00:00.000Z",
    records: [
      makeRecord("r008a", 1, "suspected", { pain: true, discharge: true, cloudyDialysate: false }),
      makeRecord("r008b", 5, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r008c", 9, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r008d", 13, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r008e", 17, "suspected", { pain: true, discharge: true, cloudyDialysate: true }),
    ],
  },
  {
    id: "p009",
    caseNumber: "I9012345",
    name: "許文彬",
    age: 78,
    gender: "male",
    lineUsername: "hsu_wenbin",
    diagnosisDate: "2020-12-10T00:00:00.000Z",
    records: [
      makeRecord("r009a", 2, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r009b", 6, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r009c", 10, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r009d", 14, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r009e", 18, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r009f", 22, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
  {
    id: "p010",
    caseNumber: "J0123456",
    name: "蔡宜珊",
    age: 52,
    gender: "female",
    lineUsername: "tsai_yishan",
    diagnosisDate: "2023-01-05T00:00:00.000Z",
    records: [
      makeRecord("r010a", 1, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r010b", 5, "suspected", { pain: true, discharge: false, cloudyDialysate: true }),
      makeRecord("r010c", 9, "suspected", { pain: true, discharge: true, cloudyDialysate: true }),
      makeRecord("r010d", 13, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r010e", 17, "normal", { pain: false, discharge: false, cloudyDialysate: false }),
      makeRecord("r010f", 21, "rejected", { pain: false, discharge: false, cloudyDialysate: false }),
    ],
  },
];

export function getPatientById(id: string): Patient | undefined {
  return MOCK_PATIENTS.find((p) => p.id === id);
}

export function filterPatients(params: {
  months?: number;
  ageMin?: number;
  ageMax?: number;
  gender?: "all" | "male" | "female";
  infectionStatus?: "all" | "suspected" | "normal";
}): Patient[] {
  const { months = 12, ageMin, ageMax, gender = "all", infectionStatus = "all" } = params;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  return MOCK_PATIENTS.filter((p) => {
    if (gender !== "all" && p.gender !== gender) return false;
    if (ageMin !== undefined && p.age < ageMin) return false;
    if (ageMax !== undefined && p.age > ageMax) return false;

    const periodRecords = p.records.filter((r) => new Date(r.uploadedAt) >= cutoff);
    if (periodRecords.length === 0) return false;

    if (infectionStatus === "suspected") {
      return periodRecords.some((r) => r.aiResult.classification === "suspected");
    }
    if (infectionStatus === "normal") {
      return !periodRecords.some((r) => r.aiResult.classification === "suspected");
    }
    return true;
  });
}

export function getPeriodRecords(patient: Patient, months: number): PhotoRecord[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return patient.records.filter((r) => new Date(r.uploadedAt) >= cutoff);
}

export function getStats(patients: Patient[], months: number) {
  const total = patients.length;
  let totalUploads = 0;
  let suspectedCount = 0;

  for (const p of patients) {
    const recs = getPeriodRecords(p, months);
    totalUploads += recs.length;
    if (recs.some((r) => r.aiResult.classification === "suspected")) suspectedCount++;
  }

  return { total, totalUploads, suspectedCount };
}
