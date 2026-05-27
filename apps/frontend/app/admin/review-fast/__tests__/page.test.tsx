import { render, screen } from "@testing-library/react";

import AdminFastReviewPage from "@/app/admin/review-fast/page";
import { useRapidReviewGridState } from "@/app/admin/_components/rapid-review-grid-state";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: { alt?: string; src?: string } & Record<string, unknown>) => {
    const { alt, src } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} src={typeof src === "string" ? src : ""} />;
  },
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/app/admin/_components/rapid-review-grid-state", () => ({
  useRapidReviewGridState: jest.fn(),
}));

type QueueItem = {
  upload_id: number;
  patient_id: number;
  case_number: string;
  full_name: string | null;
  line_user_id: string | null;
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  has_annotation: boolean;
  risk_rank: number;
  symptom_pain: boolean;
  symptom_discharge: boolean;
  symptom_pus: boolean;
};

function makeQueueItem(overrides?: Partial<QueueItem>): QueueItem {
  return {
    upload_id: 101,
    patient_id: 1,
    case_number: "P123456",
    full_name: "Patient A",
    line_user_id: "U_PATIENT_A",
    created_at: "2026-05-27T00:00:00Z",
    screening_result: "suspected",
    probability: 0.9,
    has_annotation: false,
    risk_rank: 0,
    symptom_pain: false,
    symptom_discharge: false,
    symptom_pus: false,
    ...overrides,
  };
}

describe("AdminFastReviewPage symptom modal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("shows only positive symptoms in modal", async () => {
    const selectedItem = makeQueueItem({ symptom_pain: true, symptom_discharge: false, symptom_pus: true });
    (useRapidReviewGridState as jest.Mock).mockReturnValue({
      loading: false,
      saving: false,
      bulkSaving: false,
      error: null,
      visibleItems: [selectedItem],
      imageUrlByUploadId: { 101: "/mock.jpg" },
      imageLoadErrorByUploadId: {},
      selectedItem,
      remainingCount: 1,
      reloadQueue: jest.fn(),
      selectUpload: jest.fn(),
      annotateUpload: jest.fn(),
      acceptAllVisible: jest.fn(),
    });

    render(<AdminFastReviewPage />);

    expect(await screen.findByText("症狀")).toBeInTheDocument();
    expect(screen.getByText("疼痛")).toBeInTheDocument();
    expect(screen.getByText("膿液")).toBeInTheDocument();
    expect(screen.queryByText("分泌物")).not.toBeInTheDocument();
    expect(screen.queryByText("無症狀")).not.toBeInTheDocument();
  });

  test("shows 無症狀 when no symptoms are positive", async () => {
    const selectedItem = makeQueueItem({ symptom_pain: false, symptom_discharge: false, symptom_pus: false });
    (useRapidReviewGridState as jest.Mock).mockReturnValue({
      loading: false,
      saving: false,
      bulkSaving: false,
      error: null,
      visibleItems: [selectedItem],
      imageUrlByUploadId: { 101: "/mock.jpg" },
      imageLoadErrorByUploadId: {},
      selectedItem,
      remainingCount: 1,
      reloadQueue: jest.fn(),
      selectUpload: jest.fn(),
      annotateUpload: jest.fn(),
      acceptAllVisible: jest.fn(),
    });

    render(<AdminFastReviewPage />);

    expect(await screen.findByText("症狀")).toBeInTheDocument();
    expect(screen.getByText("無症狀")).toBeInTheDocument();
    expect(screen.queryByText("疼痛")).not.toBeInTheDocument();
    expect(screen.queryByText("分泌物")).not.toBeInTheDocument();
    expect(screen.queryByText("膿液")).not.toBeInTheDocument();
  });
});
