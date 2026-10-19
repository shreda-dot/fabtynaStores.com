-- =====================================================================
-- AccountEntryType: the four values the accounts feature needs
-- =====================================================================
-- WHY THIS IS ITS OWN MIGRATION
-- -----------------------------
-- PostgreSQL refuses to *use* a new enum label in the same transaction that
-- added it ("unsafe use of new value … of enum type"). Prisma applies each
-- migration file inside its own transaction, so the labels have to be added
-- by one migration and first used by the next. Migration
-- `20261019000100_account_ledger_sources` is that next migration: it is the
-- first place `PURCHASE_PAYMENT`, `OPENING_BALANCE`, `LOAN_DISBURSEMENT` and
-- `LOAN_REPAYMENT` appear in a CHECK constraint, a trigger body or a row.
--
-- This file therefore contains NOTHING but the four `ADD VALUE` statements.
-- Do not merge it into the following migration — that would put an `ADD VALUE`
-- and a use of the label back into one transaction and fail on a clean
-- database.
--
-- `ADD VALUE` can only append, so the values end up after `ADJUSTMENT` in the
-- type's order. Order carries no meaning; `schema.prisma` lists them last for
-- the same reason.

ALTER TYPE "AccountEntryType" ADD VALUE IF NOT EXISTS 'PURCHASE_PAYMENT';
ALTER TYPE "AccountEntryType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE "AccountEntryType" ADD VALUE IF NOT EXISTS 'LOAN_DISBURSEMENT';
ALTER TYPE "AccountEntryType" ADD VALUE IF NOT EXISTS 'LOAN_REPAYMENT';
