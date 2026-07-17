import {
  isSymptomElevatedFromNormal,
  type SymptomFlags,
} from "@/lib/symptoms";

const none: SymptomFlags = {
  pain: false,
  discharge: false,
  pus: false,
  cloudyDialysate: false,
};

const painOnly: SymptomFlags = { ...none, pain: true };
const dischargeOnly: SymptomFlags = { ...none, discharge: true };

describe("isSymptomElevatedFromNormal", () => {
  it("is true only for image-normal plus high-risk symptoms", () => {
    expect(isSymptomElevatedFromNormal("normal", painOnly)).toBe(true);
    expect(
      isSymptomElevatedFromNormal("normal", { ...none, cloudyDialysate: true })
    ).toBe(true);
  });

  it("is false when AI is already suspected even with high-risk symptoms", () => {
    expect(isSymptomElevatedFromNormal("suspected", painOnly)).toBe(false);
  });

  it("is false when AI is normal without high-risk symptoms", () => {
    expect(isSymptomElevatedFromNormal("normal", none)).toBe(false);
    expect(isSymptomElevatedFromNormal("normal", dischargeOnly)).toBe(false);
  });

  it("is false for rejected and technical_error", () => {
    expect(isSymptomElevatedFromNormal("rejected", painOnly)).toBe(false);
    expect(isSymptomElevatedFromNormal("technical_error", painOnly)).toBe(false);
  });
});
