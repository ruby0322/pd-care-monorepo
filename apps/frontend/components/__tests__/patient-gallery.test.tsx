import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PatientGalleryView } from "@/components/patient-gallery";
import type { GalleryMonthResponse, GalleryUploadsResponse } from "@/lib/api/upload-history";

const mockBack = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img alt={alt} src={src} />
  ),
}));

jest.mock("@/lib/utils/upload-calendar", () => {
  const actual = jest.requireActual<typeof import("@/lib/utils/upload-calendar")>("@/lib/utils/upload-calendar");
  return {
    ...actual,
    getTaipeiTodayKey: () => "2026-05-25",
  };
});

function makeUploads(): GalleryUploadsResponse {
  return {
    has_more_older: false,
    limit: 30,
    items: [
      {
        upload_id: 1,
        created_at: "2026-05-01T00:00:00Z",
        date: "2026-05-01",
        image_url: "/u1.jpg",
        image_expires_in: 300,
        has_suspected_risk: false,
      },
      {
        upload_id: 2,
        created_at: "2026-05-02T00:00:00Z",
        date: "2026-05-02",
        image_url: "/u2.jpg",
        image_expires_in: 300,
        has_suspected_risk: true,
      },
      {
        upload_id: 3,
        created_at: "2026-05-03T00:00:00Z",
        date: "2026-05-03",
        image_url: "/u3.jpg",
        image_expires_in: 300,
        has_suspected_risk: false,
      },
    ],
  };
}

function makeMonth(): GalleryMonthResponse {
  return {
    month: "2026-05",
    has_more_older: false,
    days: [
      {
        date: "2026-05-03",
        upload_count: 1,
        has_suspected_risk: true,
        representative_image_url: "/cover.jpg",
      },
    ],
  };
}

describe("PatientGalleryView", () => {
  beforeEach(() => {
    mockBack.mockClear();
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
        takeRecords: jest.fn(() => []),
      })),
    });
  });

  test("renders a 3-column grid of uploads with newest last", async () => {
    const fetchUploads = jest.fn().mockResolvedValue(makeUploads());
    const fetchMonth = jest.fn().mockResolvedValue(makeMonth());
    render(
      <PatientGalleryView
        fetchUploads={fetchUploads}
        fetchMonth={fetchMonth}
        onUploadClick={jest.fn()}
        onDayClick={jest.fn()}
      />
    );

    const grid = await screen.findByTestId("gallery-grid");
    expect(grid).toHaveClass("grid-cols-3");
    const cells = screen.getAllByTestId("gallery-grid-cell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("aria-label", "上傳 2026-05-01");
    expect(cells[2]).toHaveAttribute("aria-label", "上傳 2026-05-03");
    const gridTab = screen.getByRole("tab", { name: "九宮格" });
    const calendarTab = screen.getByRole("tab", { name: "日曆" });
    expect(gridTab).toHaveAttribute("aria-selected", "true");
    expect(gridTab).toHaveClass("flex-1", "bg-zinc-200", "border-zinc-700");
    expect(calendarTab).toHaveClass("flex-1", "border-transparent");
    expect(calendarTab.className).not.toContain("bg-zinc-200");
    expect(screen.getByRole("tablist", { name: "相簿顯示模式" }).className).toContain("w-[calc(100%+2rem)]");
  });

  test("shows a 3-column grid skeleton while uploads load", async () => {
    let resolveUploads: ((value: GalleryUploadsResponse) => void) | null = null;
    const fetchUploads = jest.fn().mockImplementation(
      () =>
        new Promise<GalleryUploadsResponse>((resolve) => {
          resolveUploads = resolve;
        })
    );
    render(
      <PatientGalleryView
        fetchUploads={fetchUploads}
        fetchMonth={jest.fn().mockResolvedValue(makeMonth())}
        onUploadClick={jest.fn()}
        onDayClick={jest.fn()}
      />
    );

    expect(screen.getByTestId("gallery-grid-skeleton")).toHaveClass("grid-cols-3");
    expect(screen.getAllByTestId("gallery-grid-skeleton-cell")).toHaveLength(12);
    expect(screen.queryByTestId("gallery-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("載入中...")).not.toBeInTheDocument();

    resolveUploads?.(makeUploads());
    expect(await screen.findByTestId("gallery-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("gallery-grid-skeleton")).not.toBeInTheDocument();
  });

  test("上一頁 uses browser history back", async () => {
    render(
      <PatientGalleryView
        fetchUploads={jest.fn().mockResolvedValue(makeUploads())}
        fetchMonth={jest.fn().mockResolvedValue(makeMonth())}
        onUploadClick={jest.fn()}
        onDayClick={jest.fn()}
      />
    );

    await screen.findByTestId("gallery-grid");
    fireEvent.click(screen.getByRole("button", { name: "上一頁" }));
    expect(mockBack).toHaveBeenCalled();
  });

  test("calendar mode stacks the current photo month", async () => {
    const fetchUploads = jest.fn().mockResolvedValue(makeUploads());
    const fetchMonth = jest.fn().mockResolvedValue(makeMonth());
    render(
      <PatientGalleryView
        fetchUploads={fetchUploads}
        fetchMonth={fetchMonth}
        onUploadClick={jest.fn()}
        onDayClick={jest.fn()}
      />
    );

    await screen.findByTestId("gallery-grid");
    fireEvent.click(screen.getByRole("tab", { name: "日曆" }));

    await waitFor(() => {
      expect(fetchMonth).toHaveBeenCalledWith("2026-05");
    });
    expect(screen.getByRole("tab", { name: "日曆" })).toHaveClass("bg-zinc-200", "border-zinc-700");
    expect(screen.getByRole("tab", { name: "九宮格" }).className).not.toContain("bg-zinc-200");
    expect(await screen.findByRole("heading", { name: "2026 年 5 月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026-05-03 1 uploads" }).querySelector("img")).toHaveAttribute(
      "src",
      "/cover.jpg"
    );
  });

  test("shows a month skeleton while calendar mode loads", async () => {
    let resolveMonth: ((value: GalleryMonthResponse) => void) | null = null;
    const fetchMonth = jest.fn().mockImplementation(
      () =>
        new Promise<GalleryMonthResponse>((resolve) => {
          resolveMonth = resolve;
        })
    );
    render(
      <PatientGalleryView
        fetchUploads={jest.fn().mockResolvedValue(makeUploads())}
        fetchMonth={fetchMonth}
        onUploadClick={jest.fn()}
        onDayClick={jest.fn()}
      />
    );

    await screen.findByTestId("gallery-grid");
    fireEvent.click(screen.getByRole("tab", { name: "日曆" }));

    expect(screen.getByTestId("gallery-calendar-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("gallery-calendar-skeleton-cell")).toHaveLength(42);
    expect(screen.queryByRole("heading", { name: "2026 年 5 月" })).not.toBeInTheDocument();

    resolveMonth?.(makeMonth());
    expect(await screen.findByRole("heading", { name: "2026 年 5 月" })).toBeInTheDocument();
    expect(screen.queryByTestId("gallery-calendar-skeleton")).not.toBeInTheDocument();
  });
});
