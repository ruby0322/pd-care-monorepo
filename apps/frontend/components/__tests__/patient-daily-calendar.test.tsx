import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/components/ui/carousel", () => {
  const ReactLocal = jest.requireActual<typeof import("react")>("react");
  type Listener = () => void;

  type FakeApi = {
    selectedScrollSnap: () => number;
    scrollTo: (index: number) => void;
    on: (_event: string, listener: Listener) => void;
    off: (_event: string, listener: Listener) => void;
  };

  const createApi = (setIndex: React.Dispatch<React.SetStateAction<number>>): FakeApi => {
    const listeners = new Set<Listener>();
    const selectedRef = { current: 0 };
    return {
      selectedScrollSnap: () => selectedRef.current,
      scrollTo: (index: number) => {
        selectedRef.current = index;
        setIndex(index);
        listeners.forEach((listener) => listener());
      },
      on: (_event: string, listener: Listener) => {
        listeners.add(listener);
      },
      off: (_event: string, listener: Listener) => {
        listeners.delete(listener);
      },
    };
  };

  return {
    Carousel: ({
      children,
      setApi,
      ...props
    }: {
      children: React.ReactNode;
      setApi?: (api: FakeApi) => void;
    }) => {
      const [index, setIndex] = ReactLocal.useState(0);
      const apiRef = ReactLocal.useRef<FakeApi | null>(null);
      if (!apiRef.current) {
        apiRef.current = createApi(setIndex);
      }
      ReactLocal.useEffect(() => {
        setApi?.(apiRef.current as FakeApi);
      }, [setApi]);
      return (
        <div role="region" aria-roledescription="carousel" data-carousel-index={index} {...props}>
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

const days = [
  { date: "2026-05-03", upload_count: 1, has_suspected_risk: false },
  { date: "2026-05-04", upload_count: 2, has_suspected_risk: false },
  { date: "2026-05-05", upload_count: 1, has_suspected_risk: true },
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

  test("reaches oldest edge and triggers load callback once", () => {
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

    expect(onReachOldestEdge).toHaveBeenCalledTimes(1);
    expect(onReachOldestEdge).toHaveBeenCalledWith("2026-03");
  });

  test("calendar no longer applies conflicting gutter override classes", () => {
    render(<PatientDailyCalendar days={days} />);

    expect(screen.getByTestId("calendar-carousel-content")).not.toHaveClass("ml-0");
    const firstSlide = screen.getAllByTestId("calendar-carousel-item")[0];
    expect(firstSlide).not.toHaveClass("pl-0");
  });
});
