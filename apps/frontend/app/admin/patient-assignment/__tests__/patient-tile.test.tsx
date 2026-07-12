import { render, screen } from "@testing-library/react";

import { PatientTile, type PatientTilePatient } from "@/app/admin/patient-assignment/patient-tile";

jest.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: { "data-testid": "draggable" },
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    isDragging: false,
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

    const squareLayer = container.querySelector(".md\\:group-hover\\/tile\\:visible");
    expect(squareLayer).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
  });

  test("uses initials placeholder in square layer when no picture is set", () => {
    render(
      <PatientTile
        patient={{ ...patient, picture_url: null }}
        dragId="pool-101"
        fromStaffId={null}
        expandOnHoverDesktop
        className="h-12 w-[148px]"
      />
    );

    expect(screen.getAllByText("王")).toHaveLength(2);
  });

  test("does not add hover group without expandOnHoverDesktop", () => {
    const { container } = render(
      <PatientTile patient={patient} dragId="pool-101" fromStaffId={null} className="h-12 w-[148px]" />
    );

    expect(container.firstElementChild).not.toHaveClass("group/tile");
  });
});
