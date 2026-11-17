// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductForm } from "./product-form";

vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ offline: false }),
}));

afterEach(cleanup);

function fillProduct() {
  fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Test drink" } });
  fireEvent.change(screen.getByLabelText("Retail price per unit"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Wholesale price per crate"), { target: { value: "1000" } });
}

describe("purchase container classification", () => {
  it("requires an explicit choice and submits it after the error is corrected", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProductForm pending={false} onCancel={() => {}} onSubmit={onSubmit} />);
    fillProduct();

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    expect(await screen.findAllByText("Choose whether this product uses returnable containers.")).toHaveLength(2);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Purchase containers"), { target: { value: "RETURNABLE" } });
    expect(screen.queryByText("Choose whether this product uses returnable containers.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test drink" }),
      "RETURNABLE",
    ));
  }, 20_000);

  it("accepts a non-returnable classification", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProductForm pending={false} onCancel={() => {}} onSubmit={onSubmit} />);
    fillProduct();
    fireEvent.change(screen.getByLabelText("Purchase containers"), { target: { value: "NON_RETURNABLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test drink" }),
      "NON_RETURNABLE",
    ));
  }, 20_000);
});
