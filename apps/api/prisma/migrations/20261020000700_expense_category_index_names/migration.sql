ALTER INDEX expense_categories_normalizedkey_key
  RENAME TO "expense_categories_normalizedKey_key";

ALTER INDEX expenses_categoryid_expensedate_idx
  RENAME TO "expenses_categoryId_expenseDate_idx";
