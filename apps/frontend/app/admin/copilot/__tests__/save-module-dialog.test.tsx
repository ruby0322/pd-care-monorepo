import { render, screen } from "@testing-library/react";

import { SaveModuleDialog } from "@/app/admin/copilot/_components/save-module-dialog";

describe("SaveModuleDialog visibility gating", () => {
  function renderDialog(canShare: boolean) {
    const { container } = render(
      <SaveModuleDialog
        role="admin"
        canShare={canShare}
        isSubmitting={false}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    const radio = (value: string) =>
      container.querySelector<HTMLInputElement>(`input[name="module-visibility"][value="${value}"]`);
    return { radio };
  }

  it("offers every visibility when the report queries at run time", () => {
    const { radio } = renderDialog(true);
    expect(radio("private")).toBeEnabled();
    expect(radio("staff")).toBeEnabled();
    expect(radio("admin")).toBeEnabled();
    expect(screen.queryByText(/只能存成「僅自己」/)).not.toBeInTheDocument();
  });

  /**
   * The backend refuses to store a module at anything but `private` unless its HTML calls
   * the bridge, because a report with its figures baked in shows the author's rows to every
   * viewer. Without this gate the nurse met that rule as a `422` toast after submitting.
   */
  it("allows only 僅自己 for a report whose figures are baked in, and says why", () => {
    const { radio } = renderDialog(false);
    expect(radio("private")).toBeEnabled();
    expect(radio("staff")).toBeDisabled();
    expect(radio("admin")).toBeDisabled();
    expect(screen.getByText(/只能存成「僅自己」/)).toBeInTheDocument();
  });
});
