import { Client } from "pg";
import { resolveSslConfig } from "../lib/ssl.js";
import { databaseNameOf } from "../lib/db-target.js";

/**
 * The database-side half of `db:audit` — the read-only counterpart of
 * `db:verify`.
 *
 * `db:verify` proves the *rules* are installed (migrations applied,
 * constraints, triggers and indexes present). It cannot prove the *data*
 * obeys them, because the rules it cares about here are "this column equals
 * the sum of those rows" — an invariant Postgres cannot express as a `CHECK`
 * (no subqueries allowed). So `paidKobo`, `totalKobo` and
 * `stock_balances.quantityUnits` can drift, and this script is what catches it.
 *
 * Every query below must return **zero rows** on clean data. It is strictly
 * read-only and never prints the connection string or host, only the database
 * name.
 */

export interface AuditCheck {
  name: string;
  /** What the invariant means, in one line, shown in the report. */
  description: string;
  /**
   * `fatal` checks must return no rows — a row is drift and fails the run.
   * `known` checks describe a deliberate, documented gap: their rows are
   * printed for information but never fail the run.
   */
  severity: "fatal" | "known";
  /** A single SELECT; one row per violation, with `::text` money columns. */
  sql: string;
}

export interface AuditCheckResult {
  name: string;
  description: string;
  severity: AuditCheck["severity"];
  rowCount: number;
  rows: Record<string, unknown>[];
  error?: string;
}

export interface AuditResult {
  ok: boolean;
  databaseName: string;
  checks: AuditCheckResult[];
}

/** How many offending rows to keep per check, so a broken database is readable. */
const MAX_ROWS = 25;

export const AUDIT_CHECKS: readonly AuditCheck[] = [
  // --- 1. BALANCES ---
  {
    name: "account_balances.balanceKobo = Σ account_ledger_entries.amountKobo",
    description: "The derived balance cache must match the ledger for every account.",
    severity: "fatal",
    sql: `
      SELECT COALESCE(ab."accountId", ale."accountId") AS "accountId",
             ab."balanceKobo"::text AS "balanceKobo",
             COALESCE(SUM(ale."amountKobo"), 0)::text AS "ledgerKobo"
        FROM account_balances ab
        FULL OUTER JOIN account_ledger_entries ale ON ale."accountId" = ab."accountId"
       GROUP BY COALESCE(ab."accountId", ale."accountId"), ab."accountId", ab."balanceKobo"
      HAVING ab."accountId" IS NULL
          OR ab."balanceKobo" <> COALESCE(SUM(ale."amountKobo"), 0)
       ORDER BY 1`,
  },

  // --- 2. SALE PAYMENTS ---
  {
    name: "exactly one original entry per sale_payment",
    description: "Every sale payment must have exactly one live (non-reversal) ledger entry.",
    severity: "fatal",
    sql: `
      SELECT sp.id AS "salePaymentId",
             COUNT(ale.id) AS "originalEntries"
        FROM sale_payments sp
        LEFT JOIN account_ledger_entries ale
          ON ale."salePaymentId" = sp.id AND ale."reversesEntryId" IS NULL
       GROUP BY sp.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },
  {
    name: "sale_payment: original + reversal = 0",
    description: "A voided sale payment must be perfectly negated in the ledger.",
    severity: "fatal",
    sql: `
      SELECT sp.id AS "salePaymentId",
             SUM(ale."amountKobo")::text AS "netKobo"
        FROM sale_payments sp
        JOIN account_ledger_entries ale ON ale."salePaymentId" = sp.id
       GROUP BY sp.id
      HAVING SUM(ale."amountKobo") <> 0 AND EXISTS (
        SELECT 1 FROM account_ledger_entries r WHERE r."salePaymentId" = sp.id AND r."reversesEntryId" IS NOT NULL
      )
       ORDER BY 1`,
  },

  // --- 3. SUPPLIER PAYMENTS ---
  {
    name: "exactly one original entry per supplier_payment",
    description: "Every supplier payment must have exactly one live ledger entry.",
    severity: "fatal",
    sql: `
      SELECT sp.id AS "supplierPaymentId",
             COUNT(ale.id) AS "originalEntries"
        FROM supplier_payments sp
        LEFT JOIN account_ledger_entries ale
          ON ale."supplierPaymentId" = sp.id AND ale."reversesEntryId" IS NULL
       GROUP BY sp.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },
  {
    name: "supplier_payment: original + reversal = 0",
    description: "A voided supplier payment must be perfectly negated.",
    severity: "fatal",
    sql: `
      SELECT sp.id AS "supplierPaymentId",
             SUM(ale."amountKobo")::text AS "netKobo"
        FROM supplier_payments sp
        JOIN account_ledger_entries ale ON ale."supplierPaymentId" = sp.id
       GROUP BY sp.id
      HAVING SUM(ale."amountKobo") <> 0 AND EXISTS (
        SELECT 1 FROM account_ledger_entries r WHERE r."supplierPaymentId" = sp.id AND r."reversesEntryId" IS NOT NULL
      )
       ORDER BY 1`,
  },

  // --- 4. EXPENSES ---
  {
    name: "exactly one original entry per account-affecting expense",
    description: "Every non-LOAN_INTEREST expense must have exactly one live ledger entry.",
    severity: "fatal",
    sql: `
      SELECT e.id AS "expenseId",
             COUNT(ale.id) AS "originalEntries"
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e."categoryId"
        LEFT JOIN account_ledger_entries ale
          ON ale."expenseId" = e.id AND ale."reversesEntryId" IS NULL
       WHERE ec.code IS DISTINCT FROM 'LOAN_INTEREST'
       GROUP BY e.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },
  {
    name: "expense: original + reversal = 0",
    description: "A voided expense must be perfectly negated.",
    severity: "fatal",
    sql: `
      SELECT e.id AS "expenseId",
             SUM(ale."amountKobo")::text AS "netKobo"
        FROM expenses e
        JOIN account_ledger_entries ale ON ale."expenseId" = e.id
       GROUP BY e.id
      HAVING SUM(ale."amountKobo") <> 0 AND e."voidedAt" IS NOT NULL
       ORDER BY 1`,
  },

  // --- 5. LOAN DISBURSEMENTS ---
  {
    name: "exactly one original entry per loan (disbursement)",
    description: "Every loan disbursement must have exactly one live ledger entry.",
    severity: "fatal",
    sql: `
      SELECT l.id AS "loanId",
             COUNT(ale.id) AS "originalEntries"
        FROM loans l
        LEFT JOIN account_ledger_entries ale
          ON ale."loanId" = l.id AND ale."reversesEntryId" IS NULL
       GROUP BY l.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },

  // --- 6. LOAN REPAYMENTS ---
  {
    name: "exactly one original entry per loan_repayment",
    description: "Every loan repayment must have exactly one live ledger entry.",
    severity: "fatal",
    sql: `
      SELECT lr.id AS "repaymentId",
             COUNT(ale.id) AS "originalEntries"
        FROM loan_repayments lr
        LEFT JOIN account_ledger_entries ale
          ON ale."loanRepaymentId" = lr.id AND ale."reversesEntryId" IS NULL
       GROUP BY lr.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },

  // --- 7. TRANSFERS ---
  {
    name: "exactly one original entry per side of a transfer",
    description: "Every account transfer must have one live TRANSFER_IN and one live TRANSFER_OUT entry.",
    severity: "fatal",
    sql: `
      SELECT at.id AS "transferId",
             COUNT(ale.id) AS "entryCount"
        FROM account_transfers at
        LEFT JOIN account_ledger_entries ale
          ON ale."accountTransferId" = at.id AND ale."reversesEntryId" IS NULL
       GROUP BY at.id
      HAVING COUNT(ale.id) <> 2
       ORDER BY 1`,
  },
  {
    name: "purchase, loan and transfer reversals net to zero",
    description: "A reversal of a purchase payment, loan movement or transfer leg must exactly negate its original.",
    severity: "fatal",
    sql: `
      WITH linked_entries AS (
        SELECT 'purchase'::text AS source_type, "purchaseId" AS source_id,
               type::text AS entry_type, "amountKobo", "reversesEntryId"
          FROM account_ledger_entries
         WHERE "purchaseId" IS NOT NULL
        UNION ALL
        SELECT 'loan', "loanId", type::text, "amountKobo", "reversesEntryId"
          FROM account_ledger_entries
         WHERE "loanId" IS NOT NULL
        UNION ALL
        SELECT 'loan_repayment', "loanRepaymentId", type::text, "amountKobo", "reversesEntryId"
          FROM account_ledger_entries
         WHERE "loanRepaymentId" IS NOT NULL
        UNION ALL
        SELECT 'account_transfer', "accountTransferId", type::text, "amountKobo", "reversesEntryId"
          FROM account_ledger_entries
         WHERE "accountTransferId" IS NOT NULL
      )
      SELECT source_type AS "sourceType", source_id AS "sourceId", entry_type AS "entryType",
             SUM("amountKobo")::text AS "netKobo"
        FROM linked_entries
       GROUP BY source_type, source_id, entry_type
      HAVING BOOL_OR("reversesEntryId" IS NOT NULL) AND SUM("amountKobo") <> 0
       ORDER BY 1, 2, 3`,
  },
  {
    name: "exactly one original entry per paid supplier-less purchase",
    description: "Every supplier-less paid purchase is represented by one PURCHASE_PAYMENT account entry.",
    severity: "fatal",
    sql: `
      SELECT p.id AS "purchaseId", COUNT(ale.id) AS "originalEntries"
        FROM purchases p
        LEFT JOIN account_ledger_entries ale
          ON ale."purchaseId" = p.id
         AND ale.type = 'PURCHASE_PAYMENT'
         AND ale."reversesEntryId" IS NULL
       WHERE p."supplierId" IS NULL AND p."paidKobo" > 0
       GROUP BY p.id
      HAVING COUNT(ale.id) <> 1
       ORDER BY 1`,
  },

  // --- 8. SOURCE CHECK ---
  {
    name: "account ledger source cardinality",
    description: "Source-backed entries have exactly one source; designated manual entries have none.",
    severity: "fatal",
    sql: `
      WITH source_counts AS (
        SELECT id, type,
               (CASE WHEN "salePaymentId"     IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "customerPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "supplierPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "purchaseId"        IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "expenseId"         IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "otherIncomeId"     IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "accountTransferId" IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "customerRefundId"  IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "loanId"            IS NOT NULL THEN 1 ELSE 0 END) +
               (CASE WHEN "loanRepaymentId"   IS NOT NULL THEN 1 ELSE 0 END) AS source_count,
               CASE type
                 WHEN 'SALE_PAYMENT' THEN "salePaymentId" IS NOT NULL
                 WHEN 'CUSTOMER_PAYMENT' THEN "customerPaymentId" IS NOT NULL
                 WHEN 'SUPPLIER_PAYMENT' THEN "supplierPaymentId" IS NOT NULL
                 WHEN 'PURCHASE_PAYMENT' THEN "purchaseId" IS NOT NULL
                 WHEN 'EXPENSE' THEN "expenseId" IS NOT NULL
                 WHEN 'CUSTOMER_REFUND' THEN "customerRefundId" IS NOT NULL
                 WHEN 'TRANSFER_IN' THEN "accountTransferId" IS NOT NULL
                 WHEN 'TRANSFER_OUT' THEN "accountTransferId" IS NOT NULL
                 WHEN 'LOAN_DISBURSEMENT' THEN "loanId" IS NOT NULL
                 WHEN 'LOAN_REPAYMENT' THEN "loanRepaymentId" IS NOT NULL
                 ELSE FALSE
               END AS expected_source_present
          FROM account_ledger_entries
      )
      SELECT id, type, source_count, expected_source_present
        FROM source_counts
       WHERE (
         type IN ('OPENING_BALANCE', 'ADJUSTMENT', 'OWNER_CAPITAL', 'OWNER_DRAWING', 'OTHER_INCOME', 'BANK_OR_POS_CHARGE')
         AND source_count <> 0
       ) OR (
         type NOT IN ('OPENING_BALANCE', 'ADJUSTMENT', 'OWNER_CAPITAL', 'OWNER_DRAWING', 'OTHER_INCOME', 'BANK_OR_POS_CHARGE')
         AND (source_count <> 1 OR NOT expected_source_present)
       )
       ORDER BY id`,
  },

  // --- 9. LOAN INTEREST GUARD ---
  {
    name: "no entry for a LOAN_INTEREST expense",
    description: "Interest expenses land in the loan ledger, not the cash accounts.",
    severity: "fatal",
    sql: `
      SELECT ale.id, e.id AS "expenseId"
        FROM account_ledger_entries ale
        JOIN expenses e ON e.id = ale."expenseId"
        JOIN expense_categories ec ON ec.id = e."categoryId"
       WHERE ec.code = 'LOAN_INTEREST'
       ORDER BY 1`,
  },

  // --- 10. DEACTIVATED ACCOUNTS ---
  {
    name: "no entries for deactivated accounts (non-reversal)",
    description: "Only reversals are permitted on a deactivated account.",
    severity: "fatal",
    sql: `
      SELECT ale.id, a.id AS "accountId", a.name
        FROM account_ledger_entries ale
        JOIN accounts a ON a.id = ale."accountId"
       WHERE NOT a."isActive" AND ale."reversesEntryId" IS NULL
       ORDER BY 1`,
  },

  // --- 11. HEADER SUMS ---
  {
    name: "purchases.totalKobo = Σ purchase_lines.lineTotalKobo",
    description: "A purchase header must equal the sum of its lines.",
    severity: "fatal",
    sql: `
      SELECT p.id,
             p."totalKobo"::text                       AS "headerKobo",
             COALESCE(SUM(l."lineTotalKobo"), 0)::text AS "linesKobo"
        FROM purchases p
        LEFT JOIN purchase_lines l ON l."purchaseId" = p.id
       GROUP BY p.id, p."totalKobo"
      HAVING p."totalKobo" <> COALESCE(SUM(l."lineTotalKobo"), 0)
       ORDER BY p.id`,
  },
  {
    name: "sales.totalKobo = Σ sale_lines.lineTotalKobo",
    description: "A sale header must equal the sum of its lines.",
    severity: "fatal",
    sql: `
      SELECT s.id,
             s."totalKobo"::text                       AS "headerKobo",
             COALESCE(SUM(l."lineTotalKobo"), 0)::text AS "linesKobo"
        FROM sales s
        LEFT JOIN sale_lines l ON l."saleId" = s.id
       GROUP BY s.id, s."totalKobo"
      HAVING s."totalKobo" <> COALESCE(SUM(l."lineTotalKobo"), 0)
       ORDER BY s.id`,
  },
  {
    name: "purchases.paidKobo = Σ live supplier_payments.amountKobo",
    description:
      "\`paidKobo\` is denormalised from the payment rows (purchases with a supplier only). A payment whose SUPPLIER_PAYMENT account entry was reversed no longer counts.",
    severity: "fatal",
    sql: `
      SELECT p.id,
             p."paidKobo"::text                        AS "headerKobo",
             COALESCE(SUM(sp."amountKobo"), 0)::text   AS "livePaymentsKobo"
        FROM purchases p
        LEFT JOIN supplier_payments sp
          ON sp."purchaseId" = p.id
         AND NOT EXISTS (
           SELECT 1 FROM account_ledger_entries r
            WHERE r."supplierPaymentId" = sp.id
              AND r.type = 'SUPPLIER_PAYMENT'
              AND r."reversesEntryId" IS NOT NULL
         )
       WHERE p."supplierId" IS NOT NULL
       GROUP BY p.id, p."paidKobo"
      HAVING p."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0)
       ORDER BY p.id`,
  },
  {
    name: "sales.paidKobo = Σ live sale_payments.amountKobo",
    description:
      "\`paidKobo\` is denormalised from the payment rows. A later payment whose customer PAYMENT entry was reversed no longer counts. (A void leaves paidKobo alone, so a voided sale is checked the same way.)",
    severity: "fatal",
    sql: `
      SELECT s.id,
             s."paidKobo"::text                        AS "headerKobo",
             COALESCE(SUM(sp."amountKobo"), 0)::text   AS "livePaymentsKobo"
        FROM sales s
        LEFT JOIN sale_payments sp
          ON sp."saleId" = s.id
         AND NOT EXISTS (
           SELECT 1 FROM customer_ledger_entries r
            WHERE r."salePaymentId" = sp.id
              AND r.type = 'PAYMENT'
              AND r."reversesEntryId" IS NOT NULL
         )
       GROUP BY s.id, s."paidKobo"
      HAVING s."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0)
       ORDER BY s.id`,
  },

  // --- 12. STOCK ---
  {
    name: "stock_balances = Σ stock_movements.quantityUnits",
    description:
      "The derived balance cache must match the append-only movement log for every (product, location).",
    severity: "fatal",
    sql: `
      SELECT COALESCE(sb."productId", m."productId")   AS "productId",
             COALESCE(sb.location::text, m.location::text) AS "location",
             COALESCE(sb."quantityUnits", 0)::text     AS "balanceUnits",
             COALESCE(m."movementUnits", 0)::text      AS "movementUnits"
        FROM stock_balances sb
        FULL OUTER JOIN (
          SELECT "productId", location, SUM("quantityUnits") AS "movementUnits"
            FROM stock_movements
           GROUP BY "productId", location
        ) m ON m."productId" = sb."productId" AND m.location = sb.location
       WHERE COALESCE(sb."quantityUnits", 0) <> COALESCE(m."movementUnits", 0)
       ORDER BY 1, 2`,
  },
  {
    name: "supplier-less purchases: paidKobo = Σ original PURCHASE_PAYMENT entries",
    description:
      "A supplier-less purchase has no supplier_payments row; its money is the PURCHASE_PAYMENT account entry (keyed on the purchase). The original entries must add up to paidKobo for any status: a void reverses the money but leaves paidKobo alone.",
    severity: "fatal",
    sql: `
      SELECT p.id,
             p."paidKobo"::text                          AS "paidKobo",
             (-COALESCE(SUM(a."amountKobo"), 0))::text   AS "entriesKobo"
        FROM purchases p
        LEFT JOIN account_ledger_entries a
          ON a."purchaseId" = p.id
         AND a.type = 'PURCHASE_PAYMENT'
         AND a."reversesEntryId" IS NULL
       WHERE p."supplierId" IS NULL
       GROUP BY p.id, p."paidKobo"
      HAVING p."paidKobo" <> -COALESCE(SUM(a."amountKobo"), 0)
       ORDER BY p.id`,
  },

  // --- 13. EMPTIES ---
  {
    name: "empties_balances = Σ empties_movements.quantity",
    description:
      "The derived empties count cache must match the append-only movement log for every type.",
    severity: "fatal",
    sql: `
      SELECT COALESCE(eb."typeId", m."typeId")            AS "typeId",
             COALESCE(eb.quantity, 0)::text               AS "balanceQuantity",
             COALESCE(m."movementQuantity", 0)::text      AS "movementQuantity"
        FROM empties_balances eb
        FULL OUTER JOIN (
          SELECT "typeId", SUM(quantity) AS "movementQuantity"
            FROM empties_movements
           GROUP BY "typeId"
        ) m ON m."typeId" = eb."typeId"
       WHERE COALESCE(eb.quantity, 0) <> COALESCE(m."movementQuantity", 0)
       ORDER BY 1`,
  },
  {
    name: "empties movement: original + reversal = 0",
    description: "A reversed empties movement must be perfectly negated.",
    severity: "fatal",
    sql: `
      SELECT m.id AS "movementId",
             SUM(x.quantity)::text AS "netQuantity"
        FROM empties_movements m
        JOIN empties_movements x ON x.id = m.id OR x."reversesEntryId" = m.id
       WHERE m."reversesEntryId" IS NULL
       GROUP BY m.id
      HAVING SUM(x.quantity) <> 0 AND EXISTS (
        SELECT 1 FROM empties_movements r WHERE r."reversesEntryId" = m.id
      )
       ORDER BY 1`,
  },
  {
    name: "at most one live OPENING per empties type",
    description:
      "A type has a single starting count. The opening row is immutable and keeps `reversesEntryId IS NULL` even after it is reversed, so a second opening is refused for the life of the type; later corrections go through an ADJUSTMENT.",
    severity: "fatal",
    sql: `
      SELECT "typeId", COUNT(*) AS "liveOpenings"
        FROM empties_movements
       WHERE "movementType" = 'OPENING' AND "reversesEntryId" IS NULL
       GROUP BY "typeId"
      HAVING COUNT(*) > 1
       ORDER BY 1`,
  },
];

export async function runDbAudit(connectionString: string): Promise<AuditResult> {
  const client = new Client({ connectionString, ssl: resolveSslConfig(connectionString) });
  await client.connect();

  try {
    const checks: AuditCheckResult[] = [];

    for (const check of AUDIT_CHECKS) {
      try {
        const result = await client.query<Record<string, unknown>>(check.sql);
        checks.push({
          name: check.name,
          description: check.description,
          severity: check.severity,
          rowCount: result.rowCount ?? result.rows.length,
          rows: result.rows.slice(0, MAX_ROWS),
        });
      } catch (error: unknown) {
        checks.push({
          name: check.name,
          description: check.description,
          severity: check.severity,
          rowCount: 0,
          rows: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const ok = checks.every(
      (check) => check.error === undefined && (check.severity !== "fatal" || check.rowCount === 0),
    );

    return {
      ok,
      databaseName: databaseNameOf(connectionString),
      checks,
    };
  } finally {
    await client.end();
  }
}
