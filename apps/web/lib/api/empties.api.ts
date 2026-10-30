export type EmptiesKind = "BOTTLE" | "CRATE";

export type EmptiesMovementType =
  | "OPENING"
  | "RECEIVED"
  | "RETURNED_TO_OWNER"
  | "ADJUSTMENT";

export type EmptiesOwnerDto = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  typeCount: number;
  activeTypeCount: number;
};

export type EmptiesTypeDto = {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  /** Display-only unit value in kobo, or null when the type has no value. */
  unitValueKobo: string | null;
  isActive: boolean;
  createdAt: string;
};

export type EmptiesMovementDto = {
  id: string;
  typeId: string;
  movementType: EmptiesMovementType;
  /** Signed: negative for a return to the owner and for a downward adjustment. */
  quantity: number;
  note: string | null;
  occurredAt: string;
  createdById: string;
  /** Set when this row reverses another movement; such rows cannot be reversed. */
  reversesEntryId: string | null;
  createdAt: string;
};

export type EmptiesBalanceDto = {
  typeId: string;
  ownerId: string;
  ownerName: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo: string | null;
  quantity: number;
  /** `quantity * unitValueKobo`, or null when the type has no display value. */
  valueKobo: string | null;
};

export type EmptiesBalanceTotalsDto = {
  quantity: number;
  valueKobo: string;
};

export type EmptiesBalancesDto = {
  items: EmptiesBalanceDto[];
  totalsByOwner: Array<EmptiesBalanceTotalsDto & { ownerId: string; ownerName: string }>;
  totalsByKind: Array<EmptiesBalanceTotalsDto & { kind: EmptiesKind }>;
};

export type EmptiesOwnerListOptions = {
  includeInactive?: boolean;
};

export type EmptiesTypeListOptions = {
  includeInactive?: boolean;
  ownerId?: string;
};

export type EmptiesBalanceListOptions = {
  includeInactive?: boolean;
};

export type EmptiesMovementListOptions = {
  /** Lagos business dates, YYYY-MM-DD. The API defaults to today when both are missing. */
  from?: string;
  to?: string;
  typeId?: string;
  ownerId?: string;
  limit?: number;
  cursor?: string | null;
};

export type EmptiesMovementListPage = {
  items: EmptiesMovementDto[];
  nextCursor: string | null;
  /** The date range the server applied. */
  from: string | null;
  to: string | null;
};

export type CreateEmptiesOwnerInput = {
  name: string;
};

export type CreateEmptiesTypeInput = {
  ownerId: string;
  kind: EmptiesKind;
  label: string;
  unitValueKobo?: string | null;
};

export type PatchEmptiesTypeInput = {
  label?: string;
  unitValueKobo?: string | null;
};

export type CreateEmptiesMovementInput = {
  typeId: string;
  movementType: EmptiesMovementType;
  /**
   * A positive whole number for OPENING / RECEIVED / RETURNED_TO_OWNER (the
   * server applies the sign of a return). For ADJUSTMENT the value is signed
   * and must not be zero.
   */
  quantity: number;
  note?: string | null;
  occurredAt?: string;
};

export interface EmptiesApi {
  listOwners(options?: EmptiesOwnerListOptions): Promise<EmptiesOwnerDto[]>;
  createOwner(input: CreateEmptiesOwnerInput, idempotencyKey?: string): Promise<EmptiesOwnerDto>;
  renameOwner(id: string, name: string, idempotencyKey?: string): Promise<EmptiesOwnerDto>;
  setOwnerActive(id: string, isActive: boolean, idempotencyKey?: string): Promise<EmptiesOwnerDto>;

  listTypes(options?: EmptiesTypeListOptions): Promise<EmptiesTypeDto[]>;
  createType(input: CreateEmptiesTypeInput, idempotencyKey?: string): Promise<EmptiesTypeDto>;
  patchType(id: string, input: PatchEmptiesTypeInput, idempotencyKey?: string): Promise<EmptiesTypeDto>;
  setTypeActive(id: string, isActive: boolean, idempotencyKey?: string): Promise<EmptiesTypeDto>;

  listBalances(options?: EmptiesBalanceListOptions): Promise<EmptiesBalancesDto>;

  listMovements(options?: EmptiesMovementListOptions): Promise<EmptiesMovementListPage>;
  createMovement(input: CreateEmptiesMovementInput, idempotencyKey?: string): Promise<EmptiesMovementDto>;
  reverseMovement(id: string, reason: string, idempotencyKey?: string): Promise<EmptiesMovementDto>;
}
