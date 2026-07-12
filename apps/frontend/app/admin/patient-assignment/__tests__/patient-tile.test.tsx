import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PatientTile, type PatientTilePatient } from "@/app/admin/patient-assignment/patient-tile";

let isDragging = false;

jest.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: { "data-testid": "draggable" },
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    isDragging,
  }),
}));

const patient: PatientTilePatient = {
  patient_id: 101,
  case_number: "P-000101",
  patient_full_name: "王小明",
  gender: "male",
  picture_url: "https://example.com/avatar.jpg",
};

describe("PatientTile", () => {
  beforeEach(() => {
    isDragging = false;
  });

  test("renders chip layout with patient name", () => {
    const { container } = render(
      <PatientTile patient={patient} dragId="pool-101" fromStaffId={null} className="h-12 w-[148px]" />
    );

    expect(screen.getByText("王小明")).toBeInTheDocument();
    expect(screen.getByText("男")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", patient.picture_url);
  });

  test("adds hover group and instant square layer when expandOnHoverDesktop is enabled", () => {
    const { container } = render(
      <PatientTile
        patient={patient}
        dragId="pool-101"
        fromStaffId={null}
        expandOnHoverDesktop
        className="h-12 w-[148px]"
      />
    );

    const tile = container.firstElementChild;
    expect(tile).toHaveClass("group/tile");
    expect(tile).toHaveClass("transition-none");
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByTestId("patient-tile-chip-layer")).toBeInTheDocument();
    expect(screen.getByTestId("patient-tile-square-layer")).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
  });

  test("uses aria-hidden initials in square layer when no picture is set", () => {
    render(
      <PatientTile
        patient={{ ...patient, picture_url: null }}
        dragId="pool-101"
        fromStaffId={null}
        expandOnHoverDesktop
        className="h-12 w-[148px]"
      />
    );

    const squareInitial = screen.getByTestId("patient-tile-square-layer").querySelector("[aria-hidden]");
    expect(squareInitial).toHaveTextContent("王");
    expect(screen.getByText("王小明")).toBeInTheDocument();
  });

  test("does not add hover group without expandOnHoverDesktop", () => {
    const { container } = render(
      <PatientTile patient={patient} dragId="pool-101" fromStaffId={null} className="h-12 w-[148px]" />
    );

    expect(container.firstElementChild).not.toHaveClass("group/tile");
  });

  test("hides the original assigned-patient tile while dragging", () => {
    isDragging = true;
    const { container } = render(
      <PatientTile patient={patient} dragId="assigned-11-101" fromStaffId={11} className="h-12 w-[148px]" />
    );

    expect(container.firstElementChild).toHaveClass("opacity-0");
  });

  test("hides the original pool tile while dragging", () => {
    isDragging = true;
    const { container } = render(
      <PatientTile patient={patient} dragId="pool-101" fromStaffId={null} className="h-12 w-[148px]" />
    );

    expect(container.firstElementChild).toHaveClass("opacity-0");
  });
});

describe("PatientTile hover integration", () => {
  let styleEl: HTMLStyleElement;

  beforeAll(() => {
    styleEl = document.createElement("style");
    styleEl.textContent = `
      [data-testid="patient-tile-chip-layer"] { visibility: visible; }
      [data-testid="patient-tile-square-layer"] { visibility: hidden; }
      .group\\/tile[data-hover="true"] [data-testid="patient-tile-chip-layer"] { visibility: hidden; }
      .group\\/tile[data-hover="true"] [data-testid="patient-tile-square-layer"] { visibility: visible; }
    `;
    document.head.appendChild(styleEl);
  });

  afterAll(() => {
    styleEl.remove();
  });

  test("swaps chip and square layers on hover without transition classes", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PatientTile
        patient={patient}
        dragId="pool-101"
        fromStaffId={null}
        expandOnHoverDesktop
        className="h-12 w-[148px]"
      />
    );

    const tile = container.firstElementChild as HTMLElement;
    const chipLayer = screen.getByTestId("patient-tile-chip-layer");
    const squareLayer = screen.getByTestId("patient-tile-square-layer");

    expect(getComputedStyle(chipLayer).visibility).toBe("visible");
    expect(getComputedStyle(squareLayer).visibility).toBe("hidden");
    expect(tile).toHaveClass("transition-none");

    await user.hover(tile);

    expect(getComputedStyle(chipLayer).visibility).toBe("hidden");
    expect(getComputedStyle(squareLayer).visibility).toBe("visible");

    await user.unhover(tile);

    expect(getComputedStyle(chipLayer).visibility).toBe("visible");
    expect(getComputedStyle(squareLayer).visibility).toBe("hidden");
  });
});
