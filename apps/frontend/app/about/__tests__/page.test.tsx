import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AboutPage from "@/app/about/page";
import { ABOUT_FAQS, ABOUT_HISTORY_HEADING, ABOUT_TITLE } from "@/lib/seo/about-copy";

describe("about page", () => {
  test("renders the H1 and all four FAQ questions", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: ABOUT_TITLE })).toBeInTheDocument();
    for (const faq of ABOUT_FAQS) {
      expect(screen.getByRole("button", { name: faq.question })).toBeInTheDocument();
    }
  });

  test("renders project history and the NDT publication link", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { name: ABOUT_HISTORY_HEADING })).toBeInTheDocument();
    expect(screen.getByText(/鄭靜誼/)).toBeInTheDocument();
    expect(screen.getByText(/顧寬証/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nephrology Dialysis Transplantation" })).toHaveAttribute(
      "href",
      "https://academic.oup.com/ndt/article/40/Supplement_3/gfaf116.1582/8295727"
    );
  });

  test("expands a FAQ answer when its trigger is activated", async () => {
    const user = userEvent.setup();
    render(<AboutPage />);
    const first = ABOUT_FAQS[0];
    expect(screen.queryByText(first.answer)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: first.question }));
    expect(await screen.findByText(first.answer)).toBeInTheDocument();
  });
});
