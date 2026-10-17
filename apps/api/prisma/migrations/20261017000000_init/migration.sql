-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('BEER', 'SOFT_DRINK', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('RETAIL', 'WHOLESALE', 'BOTH');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('UNIT', 'PACK');

-- CreateEnum
CREATE TYPE "StockLocation" AS ENUM ('WAREHOUSE', 'RETAIL_SHELF', 'MARKET');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'TRANSFER', 'ADJUSTMENT', 'RETURN');

-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('WHOLESALE', 'RETAIL');

-- CreateEnum
CREATE TYPE "CustomerLedgerEntryType" AS ENUM ('SALE', 'PAYMENT', 'RETURN', 'CUSTOMER_REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SupplierLedgerEntryType" AS ENUM ('PURCHASE', 'PAYMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'POS');

-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('SALE_PAYMENT', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CUSTOMER_REFUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'OWNER_CAPITAL', 'OWNER_DRAWING', 'OTHER_INCOME', 'BANK_OR_POS_CHARGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'UTILITY', 'SALARY', 'TRANSPORT', 'MAINTENANCE', 'SUPPLIES', 'MARKETING', 'LOAN_INTEREST', 'OTHER');

-- CreateEnum
CREATE TYPE "LoanLedgerEntryType" AS ENUM ('DISBURSEMENT', 'CHARGE', 'REPAYMENT');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" "ProductCategory" NOT NULL,
    "packName" TEXT NOT NULL DEFAULT 'crate',
    "unitsPerPack" INTEGER NOT NULL,
    "saleChannel" "SaleChannel" NOT NULL DEFAULT 'BOTH',
    "retailPriceKobo" BIGINT NOT NULL,
    "wholesalePriceKobo" BIGINT NOT NULL,
    "averageCostKobo" BIGINT NOT NULL DEFAULT 0,
    "reorderLevelUnits" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'RETAIL',
    "creditLimitKobo" BIGINT NOT NULL DEFAULT 0,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT,
    "notes" TEXT,
    "totalKobo" BIGINT NOT NULL DEFAULT 0,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "dueDate" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitsPerPackSnapshot" INTEGER NOT NULL,
    "quantityUnits" INTEGER NOT NULL,
    "unitCostKobo" BIGINT NOT NULL,
    "lineTotalKobo" BIGINT NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "accountId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ledger_entries" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "SupplierLedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "purchaseId" TEXT,
    "supplierPaymentId" TEXT,
    "reversesEntryId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "from" "StockLocation" NOT NULL,
    "to" "StockLocation" NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityUnits" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_legs" (
    "id" TEXT NOT NULL,
    "transferLineId" TEXT NOT NULL,
    "location" "StockLocation" NOT NULL,
    "direction" "TransferDirection" NOT NULL,

    CONSTRAINT "stock_transfer_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'COMPLETED',
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "location" "StockLocation" NOT NULL,
    "quantityDeltaUnits" INTEGER NOT NULL,
    "unitCostKobo" BIGINT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "location" "StockLocation" NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityUnits" INTEGER NOT NULL,
    "unitCostKobo" BIGINT NOT NULL,
    "purchaseLineId" TEXT,
    "saleLineId" TEXT,
    "transferLegId" TEXT,
    "adjustmentLineId" TEXT,
    "returnLineId" TEXT,
    "reversesEntryId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "channel" "SaleChannel" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT,
    "notes" TEXT,
    "totalKobo" BIGINT NOT NULL DEFAULT 0,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "location" "StockLocation" NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitsPerPackSnapshot" INTEGER NOT NULL,
    "quantityUnits" INTEGER NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "costPerUnitKobo" BIGINT NOT NULL,
    "lineTotalKobo" BIGINT NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "accountId" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger_entries" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CustomerLedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "saleId" TEXT,
    "salePaymentId" TEXT,
    "customerPaymentId" TEXT,
    "saleReturnId" TEXT,
    "customerRefundId" TEXT,
    "reversesEntryId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ledger_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "AccountEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "salePaymentId" TEXT,
    "customerPaymentId" TEXT,
    "supplierPaymentId" TEXT,
    "expenseId" TEXT,
    "otherIncomeId" TEXT,
    "accountTransferId" TEXT,
    "customerRefundId" TEXT,
    "reversesEntryId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "channel" "SaleChannel" NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "loanRepaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "lenderName" TEXT NOT NULL,
    "principalKobo" BIGINT NOT NULL,
    "agreedInterestKobo" BIGINT NOT NULL DEFAULT 0,
    "disbursedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_ledger_entries" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "type" "LoanLedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "loanRepaymentId" TEXT,
    "reversesEntryId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "interestPortionKobo" BIGINT NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_snapshots" (
    "id" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_occurredAt_idx" ON "audit_logs"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_deletedAt_idx" ON "products"("deletedAt");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "suppliers_deletedAt_idx" ON "suppliers"("deletedAt");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_deletedAt_idx" ON "customers"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_reference_key" ON "purchases"("reference");

-- CreateIndex
CREATE INDEX "purchases_purchasedAt_idx" ON "purchases"("purchasedAt");

-- CreateIndex
CREATE INDEX "purchases_supplierId_purchasedAt_idx" ON "purchases"("supplierId", "purchasedAt");

-- CreateIndex
CREATE INDEX "purchases_dueDate_idx" ON "purchases"("dueDate");

-- CreateIndex
CREATE INDEX "purchase_lines_productId_idx" ON "purchase_lines"("productId");

-- CreateIndex
CREATE INDEX "supplier_payments_supplierId_paidAt_idx" ON "supplier_payments"("supplierId", "paidAt");

-- CreateIndex
CREATE INDEX "supplier_payments_purchaseId_paidAt_idx" ON "supplier_payments"("purchaseId", "paidAt");

-- CreateIndex
CREATE INDEX "supplier_payments_accountId_paidAt_idx" ON "supplier_payments"("accountId", "paidAt");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_supplierId_occurredAt_idx" ON "supplier_ledger_entries"("supplierId", "occurredAt");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_purchaseId_idx" ON "supplier_ledger_entries"("purchaseId");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_supplierPaymentId_idx" ON "supplier_ledger_entries"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_reversesEntryId_idx" ON "supplier_ledger_entries"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_reference_key" ON "stock_transfers"("reference");

-- CreateIndex
CREATE INDEX "stock_transfers_transferredAt_idx" ON "stock_transfers"("transferredAt");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_productId_idx" ON "stock_transfer_lines"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_legs_transferLineId_direction_key" ON "stock_transfer_legs"("transferLineId", "direction");

-- CreateIndex
CREATE INDEX "stock_adjustments_adjustedAt_idx" ON "stock_adjustments"("adjustedAt");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_productId_location_idx" ON "stock_adjustment_lines"("productId", "location");

-- CreateIndex
CREATE INDEX "stock_movements_productId_location_occurredAt_idx" ON "stock_movements"("productId", "location", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_type_occurredAt_idx" ON "stock_movements"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_purchaseLineId_idx" ON "stock_movements"("purchaseLineId");

-- CreateIndex
CREATE INDEX "stock_movements_saleLineId_idx" ON "stock_movements"("saleLineId");

-- CreateIndex
CREATE INDEX "stock_movements_transferLegId_idx" ON "stock_movements"("transferLegId");

-- CreateIndex
CREATE INDEX "stock_movements_adjustmentLineId_idx" ON "stock_movements"("adjustmentLineId");

-- CreateIndex
CREATE INDEX "stock_movements_returnLineId_idx" ON "stock_movements"("returnLineId");

-- CreateIndex
CREATE INDEX "stock_movements_reversesEntryId_idx" ON "stock_movements"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_reference_key" ON "sales"("reference");

-- CreateIndex
CREATE INDEX "sales_soldAt_idx" ON "sales"("soldAt");

-- CreateIndex
CREATE INDEX "sales_customerId_soldAt_idx" ON "sales"("customerId", "soldAt");

-- CreateIndex
CREATE INDEX "sale_lines_productId_saleId_idx" ON "sale_lines"("productId", "saleId");

-- CreateIndex
CREATE INDEX "sale_payments_saleId_paidAt_idx" ON "sale_payments"("saleId", "paidAt");

-- CreateIndex
CREATE INDEX "sale_payments_accountId_paidAt_idx" ON "sale_payments"("accountId", "paidAt");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_customerId_occurredAt_idx" ON "customer_ledger_entries"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_saleId_idx" ON "customer_ledger_entries"("saleId");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_salePaymentId_idx" ON "customer_ledger_entries"("salePaymentId");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_customerPaymentId_idx" ON "customer_ledger_entries"("customerPaymentId");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_saleReturnId_idx" ON "customer_ledger_entries"("saleReturnId");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_customerRefundId_idx" ON "customer_ledger_entries"("customerRefundId");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_reversesEntryId_idx" ON "customer_ledger_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "accounts_deletedAt_type_idx" ON "accounts"("deletedAt", "type");

-- CreateIndex
CREATE INDEX "account_ledger_entries_accountId_occurredAt_idx" ON "account_ledger_entries"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "account_ledger_entries_salePaymentId_idx" ON "account_ledger_entries"("salePaymentId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_customerPaymentId_idx" ON "account_ledger_entries"("customerPaymentId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_supplierPaymentId_idx" ON "account_ledger_entries"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_expenseId_idx" ON "account_ledger_entries"("expenseId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_otherIncomeId_idx" ON "account_ledger_entries"("otherIncomeId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_accountTransferId_idx" ON "account_ledger_entries"("accountTransferId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_customerRefundId_idx" ON "account_ledger_entries"("customerRefundId");

-- CreateIndex
CREATE INDEX "account_ledger_entries_reversesEntryId_idx" ON "account_ledger_entries"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_loanRepaymentId_key" ON "expenses"("loanRepaymentId");

-- CreateIndex
CREATE INDEX "expenses_expenseDate_idx" ON "expenses"("expenseDate");

-- CreateIndex
CREATE INDEX "expenses_channel_expenseDate_idx" ON "expenses"("channel", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_category_expenseDate_idx" ON "expenses"("category", "expenseDate");

-- CreateIndex
CREATE INDEX "loans_disbursedAt_idx" ON "loans"("disbursedAt");

-- CreateIndex
CREATE INDEX "loans_dueDate_idx" ON "loans"("dueDate");

-- CreateIndex
CREATE INDEX "loan_ledger_entries_loanId_occurredAt_idx" ON "loan_ledger_entries"("loanId", "occurredAt");

-- CreateIndex
CREATE INDEX "loan_ledger_entries_loanRepaymentId_idx" ON "loan_ledger_entries"("loanRepaymentId");

-- CreateIndex
CREATE INDEX "loan_ledger_entries_reversesEntryId_idx" ON "loan_ledger_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "loan_repayments_loanId_paidAt_idx" ON "loan_repayments"("loanId", "paidAt");

-- CreateIndex
CREATE INDEX "loan_repayments_expenseId_idx" ON "loan_repayments"("expenseId");

-- CreateIndex
CREATE INDEX "cash_snapshots_asOfDate_idx" ON "cash_snapshots"("asOfDate");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "supplier_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_legs" ADD CONSTRAINT "stock_transfer_legs_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "stock_transfer_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "purchase_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transferLegId_fkey" FOREIGN KEY ("transferLegId") REFERENCES "stock_transfer_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustmentLineId_fkey" FOREIGN KEY ("adjustmentLineId") REFERENCES "stock_adjustment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_salePaymentId_fkey" FOREIGN KEY ("salePaymentId") REFERENCES "sale_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "customer_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledger_entries" ADD CONSTRAINT "account_ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledger_entries" ADD CONSTRAINT "account_ledger_entries_salePaymentId_fkey" FOREIGN KEY ("salePaymentId") REFERENCES "sale_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledger_entries" ADD CONSTRAINT "account_ledger_entries_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledger_entries" ADD CONSTRAINT "account_ledger_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledger_entries" ADD CONSTRAINT "account_ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "account_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_ledger_entries" ADD CONSTRAINT "loan_ledger_entries_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_ledger_entries" ADD CONSTRAINT "loan_ledger_entries_loanRepaymentId_fkey" FOREIGN KEY ("loanRepaymentId") REFERENCES "loan_repayments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_ledger_entries" ADD CONSTRAINT "loan_ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "loan_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
