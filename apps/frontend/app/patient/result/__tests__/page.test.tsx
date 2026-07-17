import { render, screen, waitFor } from "@testing-library/react";

import ResultPage from "@/app/patient/result/page";
import { getPatientUploadResult } from "@/lib/api/predict";
import { fetchPatientUploadDetail } from "@/lib/api/upload-history";
import { getPatientSession } from "@/lib/auth/patient-session";

const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({
    alt,
    src,
  }: {
    alt: string;
    src: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img alt={alt} src={src} />
  ),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  getPatientSession: jest.fn(),
}));

jest.mock("@/lib/api/predict", () => ({
  getPatientUploadResult: jest.fn(),
}));

jest.mock("@/lib/api/upload-history", () => ({
  fetchPatientUploadDetail: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  getApiErrorDetail: jest.fn(() => null),
  getReadableApiError: jest.fn(() => "readable error"),
}));

function setParams(entries: Record<string, string>) {
  const next = new URLSearchParams(entries);
  mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
  next.forEach((value, key) => mockSearchParams.set(key, value));
}

describe("Patient ResultPage v6 layout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setParams({});
    (getPatientSession as jest.Mock).mockReturnValue({
      accessToken: "token",
      expiresAt: Date.now() + 60_000,
      role: "patient",
      lineUserId: "U1",
    });
    (getPatientUploadResult as jest.Mock).mockResolvedValue({
      upload_id: 128,
      ai_result_id: 9,
      patient_id: 1,
      screening_result: "normal",
      probability: 0.72,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: true,
      symptom_discharge: false,
      symptom_pus: true,
      created_at: "2026-07-17T09:00:00+00:00",
    });
    (fetchPatientUploadDetail as jest.Mock).mockResolvedValue({
      upload_id: 128,
      created_at: "2026-07-17T09:00:00+00:00",
      date: "2026-07-17",
      screening_result: "normal",
      probability: 0.72,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: true,
      symptom_discharge: false,
      symptom_pus: true,
      annotation_label: null,
      annotation_comment: null,
      image_url: "https://example.test/upload-128.jpg",
      image_expires_in: 600,
      prev_upload_id: null,
      next_upload_id: null,
    });
  });

  test("elevated normal + high-risk symptoms shows dual tiles, red education, symptoms under preview", async () => {
    setParams({
      result: "normal",
      uploadId: "128",
      aiResultId: "9",
      confidence: "72",
      pain: "true",
      pus: "true",
    });

    render(<ResultPage />);

    await waitFor(() => {
      expect(screen.getByText("疑似感染風險")).toBeInTheDocument();
    });

    expect(screen.getByText("影像模型")).toBeInTheDocument();
    expect(screen.getByText("症狀綜合")).toBeInTheDocument();
    expect(screen.getByText(/\(72%\)/)).toBeInTheDocument();
    expect(screen.queryByText("確信度")).not.toBeInTheDocument();
    expect(screen.queryByText("紀錄編號")).not.toBeInTheDocument();

    expect(screen.getByText("本次症狀紀錄")).toBeInTheDocument();
    expect(screen.getByText("疼痛")).toBeInTheDocument();
    expect(screen.getByText("膿")).toBeInTheDocument();

    expect(screen.getByText("附加衛教影片及素材")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "導管出口換藥影片" })).toBeInTheDocument();

    expect(screen.getByText("上傳 #128")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchPatientUploadDetail).toHaveBeenCalledWith(128);
      expect(screen.getByAltText("upload-preview-128")).toHaveAttribute(
        "src",
        "https://example.test/upload-128.jpg"
      );
    });

    expect(screen.getByRole("link", { name: /回到追蹤日曆/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /返回追蹤首頁/ })).not.toBeInTheDocument();
  });

  test("normal without high-risk symptoms shows emerald education and single model tile", async () => {
    setParams({
      result: "normal",
      uploadId: "129",
      confidence: "88",
    });
    (getPatientUploadResult as jest.Mock).mockResolvedValue({
      upload_id: 129,
      ai_result_id: 10,
      patient_id: 1,
      screening_result: "normal",
      probability: 0.88,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: false,
      symptom_discharge: false,
      symptom_pus: false,
      created_at: "2026-07-17T09:00:00+00:00",
    });
    (fetchPatientUploadDetail as jest.Mock).mockResolvedValue({
      upload_id: 129,
      created_at: "2026-07-17T09:00:00+00:00",
      date: "2026-07-17",
      screening_result: "normal",
      probability: 0.88,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: false,
      symptom_discharge: false,
      symptom_pus: false,
      annotation_label: null,
      annotation_comment: null,
      image_url: "https://example.test/upload-129.jpg",
      image_expires_in: 600,
      prev_upload_id: null,
      next_upload_id: null,
    });

    render(<ResultPage />);

    await waitFor(() => {
      expect(screen.getByText("判讀傷口正常")).toBeInTheDocument();
    });

    expect(screen.getByText("影像模型")).toBeInTheDocument();
    expect(screen.queryByText("症狀綜合")).not.toBeInTheDocument();
    expect(screen.getByText(/\(88%\)/)).toBeInTheDocument();
    expect(screen.getByText("無症狀回報")).toBeInTheDocument();
    expect(screen.getByText("附加衛教影片及素材")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到追蹤日曆/ })).toHaveAttribute("href", "/patient");
  });

  test("rejected shows retake CTA and omits education", async () => {
    setParams({
      result: "rejected",
      reason: "光線不足",
    });

    render(<ResultPage />);

    expect(await screen.findByText("影像不符合判讀條件")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /重新拍攝/ })).toHaveAttribute("href", "/patient/capture");
    expect(screen.queryByText("附加衛教影片及素材")).not.toBeInTheDocument();
    expect(fetchPatientUploadDetail).not.toHaveBeenCalled();
  });

  test("true AI suspected does not show dual elevated tiles", async () => {
    setParams({
      result: "suspected",
      uploadId: "130",
      confidence: "91",
      pain: "false",
    });
    (getPatientUploadResult as jest.Mock).mockResolvedValue({
      upload_id: 130,
      ai_result_id: 11,
      patient_id: 1,
      screening_result: "suspected",
      probability: 0.91,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: false,
      symptom_discharge: false,
      symptom_pus: false,
      created_at: "2026-07-17T09:00:00+00:00",
    });
    (fetchPatientUploadDetail as jest.Mock).mockResolvedValue({
      upload_id: 130,
      created_at: "2026-07-17T09:00:00+00:00",
      date: "2026-07-17",
      screening_result: "suspected",
      probability: 0.91,
      threshold: 0.5,
      model_version: "v1",
      error_reason: null,
      symptom_pain: false,
      symptom_discharge: false,
      symptom_pus: false,
      annotation_label: null,
      annotation_comment: null,
      image_url: "https://example.test/upload-130.jpg",
      image_expires_in: 600,
      prev_upload_id: null,
      next_upload_id: null,
    });

    render(<ResultPage />);

    await waitFor(() => {
      expect(screen.getAllByText("疑似感染").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("症狀綜合")).not.toBeInTheDocument();
    expect(screen.getByText("附加衛教影片及素材")).toBeInTheDocument();
  });
});
