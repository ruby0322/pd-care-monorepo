export type Gender = "male" | "female";
export type AIClassification = "normal" | "suspected" | "rejected";

export interface AIResult {
  classification: AIClassification;
  confidence: number;
  accepted: boolean;
  rejectionReason?: string;
}

export interface Symptoms {
  pain: boolean;
  discharge: boolean;
  cloudyDialysate: boolean;
}

export interface PhotoRecord {
  id: string;
  uploadedAt: string; // ISO date string
  aiResult: AIResult;
  symptoms: Symptoms;
  photoUrl?: string;
}

export interface Patient {
  id: string;
  caseNumber: string;
  name: string;
  age: number;
  gender: Gender;
  lineUsername: string;
  diagnosisDate: string; // ISO date string
  records: PhotoRecord[];
}
