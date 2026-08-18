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
});
