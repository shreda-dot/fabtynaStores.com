import { Client } from "pg";
import { databaseNameOf, hostOf } from "./verify.js";

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
 * read-only and never prints the connection string — only the database name
 * and host.
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
  host: string;
  checks: AuditCheckResult[];
}

/** How many offending rows to keep per check, so a broken database is readable. */
const MAX_ROWS = 25;

export const AUDIT_CHECKS: readonly AuditCheck[] = [
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
    name: "purchases.paidKobo = Σ supplier_payments.amountKobo",
    description:
      "`paidKobo` is denormalised from the payment rows (purchases with a supplier only).",
    severity: "fatal",
    sql: `
      SELECT p.id,
             p."paidKobo"::text                        AS "headerKobo",
             COALESCE(SUM(sp."amountKobo"), 0)::text   AS "paymentsKobo"
        FROM purchases p
        LEFT JOIN supplier_payments sp ON sp."purchaseId" = p.id
       WHERE p."supplierId" IS NOT NULL
       GROUP BY p.id, p."paidKobo"
      HAVING p."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0)
       ORDER BY p.id`,
  },
  {
    name: "sales.paidKobo = Σ sale_payments.amountKobo",
    description: "`paidKobo` is denormalised from the payment rows.",
    severity: "fatal",
    sql: `
      SELECT s.id,
             s."paidKobo"::text                        AS "headerKobo",
             COALESCE(SUM(sp."amountKobo"), 0)::text   AS "paymentsKobo"
        FROM sales s
        LEFT JOIN sale_payments sp ON sp."saleId" = s.id
       GROUP BY s.id, s."paidKobo"
      HAVING s."paidKobo" <> COALESCE(SUM(sp."amountKobo"), 0)
       ORDER BY s.id`,
  },
  {
    name: "customer ledger SALE entry = totalKobo − paidKobo",
    description:
      "The one live SALE entry per non-voided sale carries the unpaid portion only (§4.1).",
    severity: "fatal",
    sql: `
      SELECT s.id,
             (s."totalKobo" - s."paidKobo")::text      AS "expectedKobo",
             COALESCE(SUM(cle."amountKobo"), 0)::text  AS "ledgerKobo"
        FROM sales s
        LEFT JOIN customer_ledger_entries cle
          ON cle."saleId" = s.id
         AND cle.type = 'SALE'
         AND cle."reversesEntryId" IS NULL
       WHERE s.status <> 'VOIDED'
       GROUP BY s.id, s."totalKobo", s."paidKobo"
      HAVING (s."totalKobo" - s."paidKobo") <> COALESCE(SUM(cle."amountKobo"), 0)
       ORDER BY s.id`,
  },
  {
    name: "supplier ledger PURCHASE entry = totalKobo",
    description:
      "The one live PURCHASE entry per non-voided purchase carries the full total (§4.1).",
    severity: "fatal",
    sql: `
      SELECT p.id,
             p."totalKobo"::text                       AS "expectedKobo",
             COALESCE(SUM(sle."amountKobo"), 0)::text  AS "ledgerKobo"
        FROM purchases p
        LEFT JOIN supplier_ledger_entries sle
          ON sle."purchaseId" = p.id
         AND sle.type = 'PURCHASE'
         AND sle."reversesEntryId" IS NULL
       WHERE p.status <> 'VOIDED'
         AND p."supplierId" IS NOT NULL
       GROUP BY p.id, p."totalKobo"
      HAVING p."totalKobo" <> COALESCE(SUM(sle."amountKobo"), 0)
       ORDER BY p.id`,
  },
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
    name: "paid purchases with no supplier (known exception)",
    description:
      "A supplier-less purchase records no supplier_payments row (SupplierPayment.supplierId is NOT NULL), so its paidKobo cannot be reconciled. Deliberate, not drift.",
    severity: "known",
    sql: `
      SELECT p.id, p."paidKobo"::text AS "paidKobo"
        FROM purchases p
       WHERE p."supplierId" IS NULL
         AND p."paidKobo" <> 0
       ORDER BY p.id`,
  },
];

export async function runDbAudit(connectionString: string): Promise<AuditResult> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
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
      (check) => check.error !== undefined || check.severity !== "fatal" || check.rowCount === 0,
    );

    return {
      ok,
      databaseName: databaseNameOf(connectionString),
      host: hostOf(connectionString),
      checks,
    };
  } finally {
    await client.end();
  }
}
