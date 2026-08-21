import { render, screen } from "@testing-library/react";

import AboutPage, { metadata } from "@/app/about/page";
import { ABOUT_DESCRIPTION, ABOUT_FAQS, ABOUT_HISTORY_HEADING, ABOUT_TITLE } from "@/lib/seo/about-copy";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

describe("about page", () => {
  test("renders the H1 and all four FAQ questions as visible headings and answers", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: ABOUT_TITLE })).toBeInTheDocument();
    for (const faq of ABOUT_FAQS) {
      const heading = screen.getByRole("heading", { level: 3, name: faq.question });
      expect(heading.tagName).toBe("H3");
      expect(screen.queryByRole("button", { name: faq.question })).not.toBeInTheDocument();
      expect(heading.nextElementSibling).toHaveTextContent(faq.answer);
      expect(heading.nextElementSibling?.tagName).toBe("P");
    }
  });

  test("reuses publicPageMetadata for title, description, and canonical", () => {
    expect(metadata).toEqual(
      publicPageMetadata({
        title: ABOUT_TITLE,
        description: ABOUT_DESCRIPTION,
        path: "/about",
      })
    );
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

});
