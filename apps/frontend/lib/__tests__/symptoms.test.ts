import { activeSymptomLabels, hasHighRiskSymptoms, isSymptomElevatedFromNormal } from "@/lib/symptoms";

describe("symptoms helpers", () => {
  test("treats pain or pus as high risk", () => {
    expect(hasHighRiskSymptoms({ pain: true, discharge: false, pus: false })).toBe(true);
    expect(hasHighRiskSymptoms({ pain: false, discharge: false, pus: true })).toBe(true);
    expect(hasHighRiskSymptoms({ pain: false, discharge: true, pus: false })).toBe(false);
  });

  test("elevates only when image screening is normal", () => {
    const flags = { pain: true, discharge: false, pus: false };
    expect(isSymptomElevatedFromNormal("normal", flags)).toBe(true);
    expect(isSymptomElevatedFromNormal("suspected", flags)).toBe(false);
  });

  test("labels active symptoms in display order", () => {
    expect(activeSymptomLabels({ pain: true, discharge: true, pus: true })).toEqual([
      "疼痛",
      "分泌物",
      "膿",
    ]);
  });
});
