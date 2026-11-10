import { expenseRangePresets, shiftDate } from "./expense-filters";

export type FamilySupportPreset = "Today" | "Yesterday" | "Last 14 days" | "Last 30 days" | "This month";
export type FamilySupportRange = { from: string; to: string };

export function familySupportRangePresets(businessDate: string): Array<FamilySupportRange & { label: FamilySupportPreset }> {
  const expenses = expenseRangePresets(businessDate);
  const find = (label: string): FamilySupportRange => {
    const preset = expenses.find((item) => item.label === label);
    if (!preset) throw new Error(`Missing date preset: ${label}`);
    return { from: preset.from, to: preset.to };
  };
  return [
    { label: "Today", ...find("Today") },
    { label: "Yesterday", ...find("Yesterday") },
    { label: "Last 14 days", from: shiftDate(businessDate, -13), to: businessDate },
    { label: "Last 30 days", ...find("Last 30 days") },
    { label: "This month", ...find("This month") },
  ];
}
