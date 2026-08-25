import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/components/ui/carousel", () => {
  const ReactLocal = jest.requireActual<typeof import("react")>("react");
  type Listener = () => void;

  type FakeApi = {
    selectedScrollSnap: () => number;
    scrollTo: (index: number, _jump?: boolean) => void;
    reInit: (options?: { startIndex?: number }) => void;
    on: (event: string, listener: Listener) => void;
    off: (event: string, listener: Listener) => void;
  };

  function countCarouselItems(node: React.ReactNode): number {
    let count = 0;
    ReactLocal.Children.forEach(node, (child) => {
      if (!ReactLocal.isValidElement(child)) {
        return;
      }
      const props = child.props as { "data-testid"?: string; children?: React.ReactNode };
      if (props["data-testid"] === "calendar-carousel-item") {
        count += 1;
        return;
      }
      if (props.children) {
        count += countCarouselItems(props.children);
      }
    });
    return count;
  }

  const createApi = (
    setIndex: React.Dispatch<React.SetStateAction<number>>,
    startIndex: number,
    engineCountRef: React.MutableRefObject<number>,
    slideCountRef: React.MutableRefObject<number>
  ): FakeApi => {
    const listeners = new Map<string, Set<Listener>>();
    const selectedRef = { current: startIndex };
    const listenersFor = (event: string): Set<Listener> => {
      const existing = listeners.get(event);
      if (existing) {
        return existing;
      }
      const created = new Set<Listener>();
      listeners.set(event, created);
      return created;
    };
    const emit = (event: string) => {
      listenersFor(event).forEach((listener) => listener());
    };
    const applyIndex = (index: number, event: "select" | "reInit") => {
      const max = Math.max(0, engineCountRef.current - 1);
      const next = Math.max(0, Math.min(index, max));
      const changed = next !== selectedRef.current;
      selectedRef.current = next;
      setIndex(next);
      if (event === "reInit") {
        emit("reInit");
        return;
      }
      if (changed) {
        emit("select");
      }
    };
    return {
      selectedScrollSnap: () => selectedRef.current,
      scrollTo: (index: number) => {
        applyIndex(index, "select");
      },
      reInit: (options) => {
        engineCountRef.current = slideCountRef.current;
        applyIndex(options?.startIndex ?? selectedRef.current, "reInit");
      },
      on: (event, listener) => {
        listenersFor(event).add(listener);
      },
      off: (event, listener) => {
        listenersFor(event).delete(listener);
      },
    };
  };

  return {
    Carousel: ({
      children,
      setApi,
      withGutter,
      opts,
      ...props
    }: {
      children: React.ReactNode;
      setApi?: (api: FakeApi) => void;
      withGutter?: boolean;
      opts?: { startIndex?: number; watchSlides?: boolean };
    }) => {
      void withGutter;
      const startIndex = opts?.startIndex ?? 0;
      const slideCount = Math.max(countCarouselItems(children), 1);
      const slideCountRef = ReactLocal.useRef(slideCount);
      slideCountRef.current = slideCount;
      const engineCountRef = ReactLocal.useRef(slideCount);
      const [index, setIndex] = ReactLocal.useState(startIndex);
      const apiRef = ReactLocal.useRef<FakeApi | null>(null);
      if (!apiRef.current) {
        apiRef.current = createApi(setIndex, startIndex, engineCountRef, slideCountRef);
      }
      ReactLocal.useEffect(() => {
        setApi?.(apiRef.current as FakeApi);
      }, [setApi]);
      ReactLocal.useEffect(() => {
        if (opts?.watchSlides === false) {
          return;
        }
        if (engineCountRef.current === slideCount) {
          return;
        }
        apiRef.current?.reInit();
      }, [opts?.watchSlides, slideCount]);
      return (
        <div
          role="region"
          aria-roledescription="carousel"
          data-carousel-index={index}
          data-initial-index={startIndex}
          {...props}
        >
          {children}
        </div>
      );
    },
    CarouselContent: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
    CarouselItem: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
    CarouselPrevious: (props: React.ComponentProps<"button">) => <button type="button" {...props} />,
    CarouselNext: (props: React.ComponentProps<"button">) => <button type="button" {...props} />,
  };
});

import { PatientDailyCalendar } from "@/components/patient-daily-calendar";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img alt={alt} src={src} />
  ),
}));

const days = [
  { date: "2026-05-03", upload_count: 1, has_suspected_risk: false, representative_image_url: "/covers/normal.jpg" },
  { date: "2026-05-04", upload_count: 2, has_suspected_risk: false },
  { date: "2026-05-05", upload_count: 1, has_suspected_risk: true, representative_image_url: "/covers/suspected.jpg" },
  {
    date: "2026-05-06",
    upload_count: 1,
    has_suspected_risk: false,
    has_symptom_elevated_risk: true,
    representative_image_url: "/covers/elevated.jpg",
  },
];

describe("PatientDailyCalendar month paging UI", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
        takeRecords: jest.fn(() => []),
      })),
    });
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-25T08:00:00+08:00"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders weekday labels and aligned month cells", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByText("日")).toBeInTheDocument();
    expect(screen.getByText("一")).toBeInTheDocument();
    expect(screen.getByText("二")).toBeInTheDocument();
    expect(screen.getByText("三")).toBeInTheDocument();
    expect(screen.getByText("四")).toBeInTheDocument();
    expect(screen.getByText("五")).toBeInTheDocument();
    expect(screen.getByText("六")).toBeInTheDocument();

    // each month page is 6x7 cells; carousel keeps multiple pages in DOM
    expect(screen.getAllByTestId("calendar-day-cell").length).toBeGreaterThanOrEqual(42);
  });

  test("shows day-number labels and desktop prev/next controls", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上個月" })).toHaveClass("hidden", "lg:inline-flex");
    expect(screen.getByRole("button", { name: "下個月" })).toHaveClass("hidden", "lg:inline-flex");

    // date labels should be visible in cells
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
  });

  test("backward button navigates to previous month when bounds include older months", () => {
    render(
      <PatientDailyCalendar
        days={days}
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(240);
    });
    expect(screen.getByText("4 月")).toBeInTheDocument();
  });

  test("notifies the parent after navigating to a previous month", () => {
    const onMonthChange = jest.fn();
    render(
      <PatientDailyCalendar
        days={days}
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
        onMonthChange={onMonthChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(240);
    });

    expect(onMonthChange).toHaveBeenLastCalledWith("2026-04");
  });

  test("forward button returns from an older month to the newest loaded month", () => {
    render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-04"
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "下個月" }));
    act(() => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByText("5 月")).toBeInTheDocument();
  });

  test("month header updates when initialMonthKey is controlled", () => {
    render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(120);
    });

    expect(screen.getByText("4 月")).toBeInTheDocument();
  });

  test("centers day labels and bolds current-month dates", () => {
    render(<PatientDailyCalendar days={days} />);

    const currentMonthCell = screen.getByRole("button", { name: "2026-05-01 0 uploads" });
    const mutedAdjacentCell = screen.getByRole("button", { name: "2026-04-30 0 uploads" });
    const currentLabel = currentMonthCell.querySelector("span");
    const mutedLabel = mutedAdjacentCell.querySelector("span");

    expect(currentMonthCell).toHaveClass("flex", "items-center", "justify-center");
    expect(mutedAdjacentCell).toHaveClass("flex", "items-center", "justify-center");
    expect(currentLabel).toHaveClass("font-semibold");
    expect(mutedLabel).toHaveClass("font-normal");
  });

  test("renders shadcn carousel structure for month pages", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getByTestId("calendar-carousel-content")).toBeInTheDocument();
    expect(screen.getAllByTestId("calendar-carousel-item").length).toBeGreaterThan(0);
  });

  test("future month navigation rebounds and cannot settle into next month", () => {
    render(
      <PatientDailyCalendar
        days={days}
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "下個月" }));

    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.queryByText("6 月")).not.toBeInTheDocument();
  });

  test("reaches oldest edge and triggers load callback once", async () => {
    const onReachOldestEdge = jest.fn();
    render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-04"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
        onReachOldestEdge={onReachOldestEdge}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(120);
    });
    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(120);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onReachOldestEdge).toHaveBeenCalledTimes(1);
    expect(onReachOldestEdge).toHaveBeenCalledWith("2026-03");
  });

  test("shows full-calendar overlay while background loading and keeps base cells mounted", () => {
    const { rerender } = render(
      <PatientDailyCalendar
        days={days}
        overlayLoading
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByTestId("calendar-loading-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId("calendar-skeleton-cell").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("calendar-day-cell").length).toBeGreaterThan(0);

    rerender(
      <PatientDailyCalendar
        days={days}
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.queryByTestId("calendar-loading-overlay")).not.toBeInTheDocument();
  });

  test("locks month navigation while overlay is visible", () => {
    render(
      <PatientDailyCalendar
        days={days}
        overlayLoading
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(120);
    });

    expect(screen.getByText("5 月")).toBeInTheDocument();
  });

  test("keeps current month header stable when loaded range expands older months", () => {
    const { rerender } = render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-04"
        loadedOldestMonthKey="2026-04"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByText("4 月")).toBeInTheDocument();

    rerender(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-04"
        loadedOldestMonthKey="2026-01"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByText("4 月")).toBeInTheDocument();
  });

  test("opens on the visible month instead of the oldest loaded month", () => {
    render(
      <PatientDailyCalendar
        days={[
          ...days,
          { date: "2026-03-10", upload_count: 1, has_suspected_risk: true },
        ]}
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-initial-index", "2");
    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.queryByText("3 月")).not.toBeInTheDocument();
  });

  test("does not retarget startIndex after scrolling to a previous month", () => {
    render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByText("4 月")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-initial-index", "2");
    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-carousel-index", "1");
  });

  test("keeps the navigated month when older months are prepended", () => {
    const { rerender } = render(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "上個月" }));
    act(() => {
      jest.advanceTimersByTime(240);
    });
    expect(screen.getByText("4 月")).toBeInTheDocument();

    rerender(
      <PatientDailyCalendar
        days={days}
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2025-12"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByText("4 月")).toBeInTheDocument();
    expect(screen.queryByText("5 月")).not.toBeInTheDocument();
  });

  test("stays on the current month slide after older months are prepended", () => {
    const { rerender } = render(
      <PatientDailyCalendar
        days={days}
        showCalendarModeTabs
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-carousel-index", "2");

    rerender(
      <PatientDailyCalendar
        days={days}
        showCalendarModeTabs
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2025-12"
        loadedNewestMonthKey="2026-05"
      />
    );

    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.queryByText("2 月")).not.toBeInTheDocument();
    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-carousel-index", "5");
  });

  test("photo tab does not change the visible month after older months are prepended", () => {
    const { rerender } = render(
      <PatientDailyCalendar
        days={days}
        showCalendarModeTabs
        galleryHref="/patient/gallery"
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2026-03"
        loadedNewestMonthKey="2026-05"
      />
    );

    rerender(
      <PatientDailyCalendar
        days={days}
        showCalendarModeTabs
        galleryHref="/patient/gallery"
        initialMonthKey="2026-05"
        loadedOldestMonthKey="2025-12"
        loadedNewestMonthKey="2026-05"
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "相片" }));

    expect(screen.getByRole("tab", { name: "相片" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("5 月")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-carousel")).toHaveAttribute("data-carousel-index", "5");
  });

  test("calendar no longer applies conflicting gutter override classes", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByTestId("calendar-carousel-content")).not.toHaveClass("ml-0");
    const firstSlide = screen.getAllByTestId("calendar-carousel-item")[0];
    expect(firstSlide).not.toHaveClass("pl-0");
  });

  test("renders orange elevated cells and legend for symptom-elevated days", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByText("症狀高風險")).toBeInTheDocument();
    const elevatedCell = screen.getByRole("button", { name: "2026-05-06 1 uploads" });
    expect(elevatedCell.className).toContain("bg-orange-400");
  });

  test("renders folder-tab streak badge flush with the calendar top-right corner", () => {
    render(<PatientDailyCalendar days={days} streakDays={7} />);

    const tab = screen.getByTestId("calendar-streak-tab");
    expect(tab).toHaveAttribute("aria-label", "連續上傳 7 天");
    expect(tab).toHaveTextContent("連續 7 天");
    expect(tab).toHaveTextContent("😯");
    expect(tab.className).toContain("rounded-t-xl");
    expect(tab.className).toContain("border-b-0");
    expect(tab.className).toContain("text-sm");
    expect(screen.getByRole("region", { name: "每日上傳日曆" })).toHaveClass("rounded-tr-none");
  });

  test("hides streak badge when streakDays is omitted", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.queryByTestId("calendar-streak-tab")).not.toBeInTheDocument();
  });

  test("hides calendar mode tabs unless showCalendarModeTabs is set", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.queryByRole("tab", { name: "日曆" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "相片" })).not.toBeInTheDocument();
  });

  test("renders mode tabs flush with the calendar top-left when enabled", () => {
    render(<PatientDailyCalendar days={days} showCalendarModeTabs streakDays={7} />);

    expect(screen.getByRole("tab", { name: "日曆" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "相片" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "日曆" }).querySelector("svg")).toHaveClass("h-5", "w-5");
    expect(screen.getByRole("tab", { name: "相片" }).querySelector("svg")).toHaveClass("h-5", "w-5");
    expect(screen.getByRole("region", { name: "每日上傳日曆" })).toHaveClass("rounded-tl-none");
    expect(screen.getByRole("region", { name: "每日上傳日曆" })).toHaveClass("rounded-tr-none");
  });

  test("keeps color cells in calendar-days mode even when covers exist", () => {
    render(<PatientDailyCalendar days={days} showCalendarModeTabs initialMonthKey="2026-05" />);

    const suspectedCell = screen.getByRole("button", { name: "2026-05-05 1 uploads" });
    expect(suspectedCell.className).toContain("bg-red-400");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("顏色深淺代表當日上傳次數")).not.toBeInTheDocument();
  });

  test("photo mode uses representative covers and risk borders", () => {
    render(<PatientDailyCalendar days={days} showCalendarModeTabs initialMonthKey="2026-05" />);

    fireEvent.click(screen.getByRole("tab", { name: "相片" }));

    expect(screen.getByRole("tab", { name: "相片" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "2026-05-03 1 uploads" }).querySelector("img")).toHaveAttribute(
      "src",
      "/covers/normal.jpg"
    );
    expect(screen.getByRole("button", { name: "2026-05-05 1 uploads" }).className).toContain("border-red-500");
    expect(screen.getByRole("button", { name: "2026-05-06 1 uploads" }).className).toContain("border-orange-500");
    expect(screen.getByRole("button", { name: "2026-05-05 1 uploads" }).className).not.toContain("bg-red-400");
    expect(screen.queryByText("顏色深淺代表當日上傳次數")).not.toBeInTheDocument();
    expect(screen.queryByText("一般（相片、無框）")).not.toBeInTheDocument();
  });

  test("photo mode replaces streak copy with 查看相簿 when galleryHref is set", () => {
    render(
      <PatientDailyCalendar
        days={days}
        showCalendarModeTabs
        streakDays={7}
        galleryHref="/patient/gallery"
        initialMonthKey="2026-05"
      />
    );

    expect(screen.getByTestId("calendar-streak-tab")).toHaveTextContent("連續 7 天");
    fireEvent.click(screen.getByRole("tab", { name: "相片" }));
    expect(screen.queryByTestId("calendar-streak-tab")).not.toBeInTheDocument();
    const galleryLink = screen.getByTestId("calendar-gallery-link");
    expect(galleryLink).toHaveTextContent("查看相簿");
    expect(galleryLink).toHaveAttribute("href", "/patient/gallery");
    expect(galleryLink.className).toContain("underline");
    expect(galleryLink.className).toContain("text-sm");
  });
});
