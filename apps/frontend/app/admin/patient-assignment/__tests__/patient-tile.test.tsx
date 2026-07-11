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

  test("adds hover group and a single image when expandOnHoverDesktop is enabled", () => {
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
    expect(container.querySelectorAll("img")).toHaveLength(1);

    const image = container.querySelector("img");
    expect(image).toHaveClass("md:group-hover/tile:absolute");
    expect(image).toHaveClass("md:group-hover/tile:rounded-none");
    expect(screen.getByText("王小明")).toHaveClass("md:group-hover/tile:hidden");
  });

  test("uses initials placeholder without a second image when no picture is set", () => {
    const { container } = render(
      <PatientTile
        patient={{ ...patient, picture_url: null }}
        dragId="pool-101"
        fromStaffId={null}
        expandOnHoverDesktop
        className="h-12 w-[148px]"
      />
    );

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("王")).toBeInTheDocument();
    expect(screen.getByText("王")).toHaveClass("md:group-hover/tile:absolute");
  });

  test("does not add hover group without expandOnHoverDesktop", () => {
    const { container } = render(
      <PatientTile patient={patient} dragId="pool-101" fromStaffId={null} className="h-12 w-[148px]" />
    );

    expect(container.firstElementChild).not.toHaveClass("group/tile");
  });
});
