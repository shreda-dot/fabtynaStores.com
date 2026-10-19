import { z } from "zod";
import {
    idSchema,
    isoDateTimeSchema,
    positiveKoboStringSchema,
    signedKoboStringSchema,
} from "./common.ts";

/**
 * Accounts DTOs. An account is a named place money sits (cash drawer, bank,
 * POS). Its balance is never stored — it is the sum of its account ledger
 * entries — so these schemas carry no balance field.
 */

export const accountTypeSchema = z.enum(["CASH", "BANK", "POS"]);

export const accountDtoSchema = z
    .object({
        id: idSchema,
        name: z.string().trim().min(1),
        type: accountTypeSchema,
        isActive: z.boolean(),
        deactivatedAt: isoDateTimeSchema.nullable(),
        note: z.string().nullable(),
        createdAt: isoDateTimeSchema,
        updatedAt: isoDateTimeSchema,
    })
    .strict();

export const accountTransferDtoSchema = z
    .object({
        id: idSchema,
        fromAccountId: idSchema,
        toAccountId: idSchema,
        amountKobo: positiveKoboStringSchema,
        note: z.string().nullable(),
        occurredAt: isoDateTimeSchema,
        createdAt: isoDateTimeSchema,
    })
    .strict();

export const createAccountDtoSchema = z
    .object({
        name: z.string().trim().min(1),
        type: accountTypeSchema,
        note: z.string().trim().nullable(),
    })
    .strict();

export const updateAccountDtoSchema = z
    .object({
        name: z.string().trim().min(1),
        note: z.string().trim().nullable(),
    })
    .strict();

export const createAccountTransferDtoSchema = z
    .object({
        fromAccountId: idSchema,
        toAccountId: idSchema,
        amountKobo: positiveKoboStringSchema,
        note: z.string().trim().nullable(),
        occurredAt: isoDateTimeSchema,
    })
    .strict();

export const createOpeningBalanceDtoSchema = z
    .object({
        accountId: idSchema,
        amountKobo: positiveKoboStringSchema,
        note: z.string().trim().nullable(),
        occurredAt: isoDateTimeSchema,
    })
    .strict();

export const reconcileAccountDtoSchema = z
    .object({
        accountId: idSchema,
        /** Signed correction: positive to add, negative to remove. */
        deltaKobo: signedKoboStringSchema,
        note: z.string().trim().min(1),
        occurredAt: isoDateTimeSchema,
    })
    .strict();

export const deactivateAccountDtoSchema = z
    .object({
        reason: z.string().trim().min(1),
    })
    .strict();
