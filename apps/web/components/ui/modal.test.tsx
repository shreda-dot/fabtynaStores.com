// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "@/components/ui/modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="presentation"]');
  if (element === null) throw new Error("The modal overlay was not rendered.");
  return element;
}

/**
 * Issue 2: while a write is pending the loading state must not be dismissable by
 * a tap. Every form passes `busy` from the write flow's pending state, and the
 * modal is what refuses the tap, Escape and the close button.
 */
describe("modal while a write is pending", () => {
  it("keeps the pending message after a tap on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal open busy title="Record sale" onClose={onClose}>
        <p>Still working, please keep this page open.</p>
      </Modal>,
    );

    fireEvent.mouseDown(overlay());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Still working, please keep this page open.")).toBeTruthy();
  });

  it("ignores Escape and disables the close button", () => {
    const onClose = vi.fn();
    render(
      <Modal open busy title="Record sale" onClose={onClose}>
        <p>Saving...</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Close dialog")).toHaveProperty("disabled", true);
  });

  it("closes on a backdrop tap when it is not busy (the guard is what blocks it)", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Record sale" onClose={onClose}>
        <p>Ready.</p>
      </Modal>,
    );

    fireEvent.mouseDown(overlay());

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
