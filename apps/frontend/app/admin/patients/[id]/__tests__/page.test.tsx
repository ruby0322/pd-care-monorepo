import { render, screen, waitFor } from "@testing-library/react";

import PatientDetailPage from "@/app/admin/patients/[id]/page";
import { PatientDailyCalendar } from "@/components/patient-daily-calendar";
import {
  fetchPatientAnnotations,
  fetchStaffPatientDetail,
  fetchUploadImageAccess,
} from "@/lib/api/staff";

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: { alt?: string }) => <span role="img" aria-label={props.alt ?? ""} />,
}));

jest.mock("@/components/patient-daily-calendar", () => ({
  PatientDailyCalendar: jest.fn(() => <div data-testid="patient-daily-calendar" />),
}));

jest.mock("@/lib/api/staff", () => ({
  fetchPatientAnnotations: jest.fn(),
  fetchStaffPatientDetail: jest.fn(),
  fetchUploadImageAccess: jest.fn(),
  upsertUploadAnnotation: jest.fn(),
}));

describe("Admin patient detail calendar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchPatientAnnotations as jest.Mock).mockResolvedValue([]);
    (fetchUploadImageAccess as jest.Mock).mockResolvedValue({ image_url: "/upload.jpg" });
    (fetchStaffPatientDetail as jest.Mock).mockResolvedValue({
      patient_id: 42,
      case_number: "P000042",
      full_name: "Calendar Patient",
      gender: "female",
      birth_date: "1980-01-01",
      age: 46,
      line_display_name: "Patient",
      line_user_id: "U_PATIENT",
      is_active: true,
      total_uploads: 2,
      suspected_uploads: 1,
      rejected_uploads: 0,
      uploads: [
        {
          upload_id: 1,
          created_at: "2026-04-30T16:30:00Z",
          screening_result: "normal",
          probability: 0.1,
          threshold: 0.5,
          model_version: "test",
          error_reason: null,
          content_type: "image/jpeg",
          has_annotation: false,
        },
        {
          upload_id: 2,
          created_at: "2026-06-10T08:00:00Z",
          screening_result: "suspected",
          probability: 0.8,
          threshold: 0.5,
          model_version: "test",
          error_reason: null,
          content_type: "image/jpeg",
          has_annotation: false,
        },
      ],
    });
  });

  test("passes loaded upload month bounds to the calendar", async () => {
    render(<PatientDetailPage />);

    await screen.findByTestId("patient-daily-calendar");
    await waitFor(() => {
      const calendarProps = (PatientDailyCalendar as jest.Mock).mock.calls.at(-1)?.[0];
      expect(calendarProps).toEqual(expect.objectContaining({
        loadedOldestMonthKey: "2026-05",
        loadedNewestMonthKey: "2026-06",
      }));
    });
  });
});
