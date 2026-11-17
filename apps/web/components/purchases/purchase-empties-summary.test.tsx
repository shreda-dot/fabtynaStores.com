// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PurchaseEmptiesSummary } from "./purchase-empties-summary";

afterEach(cleanup);

it("shows container events and the outstanding supplier debt separately from payables", () => {
  render(
    <PurchaseEmptiesSummary
      supplier={{ id: "supplier-1" }}
      empties={{
        tracked: true,
        requirements: [{
          purchaseLineId: "line-1",
          typeId: "crate-type",
          kind: "CRATE",
          quantity: 80,
          manualCrateCount: false,
          countPerUnitSnapshot: null,
          countPerPackSnapshot: 1,
          label: "IB crates",
        }],
        events: [
          {
            id: "event-returned",
            eventType: "RETURNED_FOR_PURCHASE",
            typeId: "crate-type",
            kind: "CRATE",
            label: "IB crates",
            obligationId: null,
            quantity: 75,
            note: null,
            reversesEntryId: null,
            reversed: false,
            occurredAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "event-gift",
            eventType: "SUPPLIED_FREE",
            typeId: "crate-type",
            kind: "CRATE",
            label: "IB crates",
            obligationId: null,
            quantity: 2,
            note: null,
            reversesEntryId: null,
            reversed: false,
            occurredAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "event-debt",
            eventType: "PURCHASE_DEBT",
            typeId: "crate-type",
            kind: "CRATE",
            label: "IB crates",
            obligationId: "obligation-1",
            quantity: 3,
            note: null,
            reversesEntryId: null,
            reversed: false,
            occurredAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        debts: [{
          id: "obligation-1",
          supplierId: "supplier-1",
          typeId: "crate-type",
          kind: "CRATE",
          label: "IB crates",
          quantity: 3,
        }],
      }}
    />,
  );

  expect(screen.getByText("Returned · IB crates crate")).toBeTruthy();
  expect(screen.getByText("Supplied free by supplier · IB crates crate")).toBeTruthy();
  expect(screen.getByText("Owed to supplier · IB crates crate")).toBeTruthy();
  expect(screen.getByText("3 remaining")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View supplier empties debt and record a return" }).getAttribute("href"))
    .toBe("/suppliers/supplier-1/empties");
});

it("renders multiple API-shaped requirements without missing or duplicate key warnings", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <PurchaseEmptiesSummary
        supplier={null}
        empties={{
          tracked: true,
          requirements: [
            { purchaseLineId: "line-1", typeId: "crate-type", kind: "CRATE", quantity: 2, manualCrateCount: false, countPerUnitSnapshot: null, countPerPackSnapshot: 1, label: "Crates" },
            { purchaseLineId: "line-1", typeId: "bottle-type", kind: "BOTTLE", quantity: 48, manualCrateCount: false, countPerUnitSnapshot: 1, countPerPackSnapshot: null, label: "Bottles" },
            { purchaseLineId: "line-2", typeId: "crate-type", kind: "CRATE", quantity: 1, manualCrateCount: false, countPerUnitSnapshot: null, countPerPackSnapshot: 1, label: "Crates" },
          ],
          events: [],
          debts: [],
        }}
      />,
    );
    expect(screen.getByText("48 required")).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});
