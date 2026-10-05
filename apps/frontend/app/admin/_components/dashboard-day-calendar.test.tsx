import { render, screen } from "@testing-library/react";

import { DashboardDayCalendar } from "@/app/admin/_components/dashboard-day-calendar";
import { getTaipeiTodayKey, getWeekStartDateKey } from "@/lib/utils/upload-calendar";

describe("DashboardDayCalendar", () => {
  test("labels the current Taipei day as 今天", () => {
    const today = getTaipeiTodayKey();
    render(
      <DashboardDayCalendar
        selectedDate={today}
        weekStartDateKey={getWeekStartDateKey(today)}
        metricsByDate={{}}
        availableDates={[today]}
        onSelectDate={() => undefined}
        onWeekChange={() => undefined}
      />
    );

    expect(screen.getAllByText("（今天）").length).toBeGreaterThan(0);
  });

  test("shows labeled uploads out of total uploads for each available day", () => {
    const today = getTaipeiTodayKey();
    render(
      <DashboardDayCalendar
        selectedDate={today}
        weekStartDateKey={getWeekStartDateKey(today)}
        metricsByDate={{
          [today]: {
            uploadCount: 8,
            labeledUploads: 3,
            uploadedUsers: 5,
            riskyPatients: 1,
            unhandledPatients: 0,
          },
        }}
        availableDates={[today]}
        onSelectDate={() => undefined}
        onWeekChange={() => undefined}
      />
    );

    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/8").length).toBeGreaterThan(0);
    expect(screen.getByText("已標註 / 總上傳")).toBeInTheDocument();
    expect(
      screen.getAllByTitle(`${today} · 已標註 3/8（38%） · 人數 5 · 風險 1`).length
    ).toBeGreaterThan(0);
  });
});
