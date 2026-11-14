// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { formatNaira } from "@fabtyna/shared";
import { MoneyFlowView } from "./money-flow-view";
import type { MoneyFlowReportDto } from "@/lib/api/accounting.api";

afterEach(cleanup);

it("keeps the existing owner drawings summary in Money Flow", () => {
  const data: MoneyFlowReportDto = {
    familySupportTakenKobo: "-250",
    totalsExcludeTransfers: true,
    rows: [{
      accountId: "cash", accountName: "Cash", accountType: "CASH",
      openingBalanceKobo: "0", moneyInKobo: "0", moneyOutKobo: "250", netKobo: "-250",
      closingBalanceKobo: "-250",
      categories: [{ key: "OWNER_DRAWING", moneyInKobo: "0", moneyOutKobo: "250" }],
    }],
    totals: { openingBalanceKobo: "0", moneyInKobo: "0", moneyOutKobo: "0", netKobo: "0", closingBalanceKobo: "0" },
    sales: { billedKobo: "0", customerMoneyReceivedKobo: "0", debtOutstandingKobo: "0" },
  };
  render(<MoneyFlowView data={data} />);
  const label = screen.getAllByText("Owner drawings")[0];
  expect(within(label.parentElement!).getByText(formatNaira(250n))).toBeTruthy();
});
