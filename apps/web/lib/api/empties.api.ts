export type EmptiesKind = "BOTTLE" | "CRATE";

export type EmptiesMovementType =
  | "OPENING"
  | "RECEIVED"
  | "RETURNED_TO_OWNER"
  | "ADJUSTMENT";

export type EmptiesCustomerMovementType =
  | "TAKEN"
  | "RETURNED"
  | "KEPT"
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
  /** Set when this RECEIVED row is paired with a customer return; reverse from customer history. */
  customerReturnMovementId: string | null;
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

export type EmptiesProductOverviewDto = {
  productId: string;
  productName: string;
  isActive: boolean;
  unitsPerPack: number;
  warehouseUnits: number;
  fullCrates: number;
  looseUnits: number;
  shelfUnits: number;
  marketUnits: number;
};

export type EmptiesOverviewOwnerDto = {
  ownerId: string;
  ownerName: string;
  emptyCrates: number;
  emptyBottles: number;
  fullCrates: number;
  looseUnitsInWarehouse: number;
  bottlesOnShelfAndMarket: number;
  totalCrates: number;
  emptyValueKobo: string | null;
  products: EmptiesProductOverviewDto[];
};

export type EmptiesStockWarningDto = {
  productId: string;
  productName: string;
  unitsPerPack: number;
  warehouseUnits: number;
  shelfUnits: number;
  marketUnits: number;
  totalUnits: number;
  ownerId?: string;
  ownerName?: string;
};

export type EmptiesOverviewDto = {
  owners: EmptiesOverviewOwnerDto[];
  warnings: {
    productsWithoutBrewery: EmptiesStockWarningDto[];
    assignedCans: EmptiesStockWarningDto[];
    productsAssignedToInactiveOwner: EmptiesStockWarningDto[];
  };
};

export type ProductOwnerDto = {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
};

export type ProductOwnerListOptions = {
  q?: string;
  assigned?: "all" | "assigned" | "unassigned";
  cursor?: string | null;
  limit?: number;
};

export type ProductOwnerListPage = {
  items: ProductOwnerDto[];
  nextCursor: string | null;
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

export type EmptiesCustomerBalanceDto = {
  customerId: string;
  customerName: string;
  typeId: string;
  label: string;
  kind: EmptiesKind;
  ownerId: string;
  ownerName: string;
  quantity: number;
  valueKobo: string | null;
  lastMovementAt: string;
};

export type EmptiesCustomerBalanceListOptions = {
  customerId?: string;
  ownerId?: string;
  typeId?: string;
  q?: string;
  onlyOwing?: boolean;
  cursor?: string | null;
  limit?: number;
};

export type EmptiesCustomerBalanceListPage = {
  items: EmptiesCustomerBalanceDto[];
  totalsByOwner: Array<{
    ownerId: string;
    ownerName: string;
    quantity: number;
    valueKobo: string | null;
  }>;
  nextCursor: string | null;
};

export type EmptiesCustomerMovementDto = {
  id: string;
  customerId: string;
  customerName: string;
  typeId: string;
  label: string;
  kind: EmptiesKind;
  ownerId: string;
  ownerName: string;
  movementType: EmptiesCustomerMovementType;
  quantity: number;
  valueKobo: string | null;
  note: string | null;
  occurredAt: string;
  createdById: string;
  emptiesMovementId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  createdAt: string;
};

export type EmptiesCustomerMovementListOptions = {
  from?: string;
  to?: string;
  customerId?: string;
  typeId?: string;
  cursor?: string | null;
  limit?: number;
};

export type EmptiesCustomerMovementListPage = {
  items: EmptiesCustomerMovementDto[];
  nextCursor: string | null;
  from: string | null;
  to: string | null;
};

export type EmptiesDepositMovementType = "RECEIVED" | "REFUNDED" | "FORFEITED";

export type EmptiesDepositBalanceDto = {
  customerId: string;
  customerName: string;
  heldKobo: string;
  lastMovementAt: string | null;
  crates: Array<{
    typeId: string;
    label: string;
    ownerName: string;
    quantity: number;
    valueKobo: string | null;
  }>;
};

export type EmptiesDepositBalanceListOptions = {
  q?: string;
  onlyHolding?: boolean;
  cursor?: string | null;
  limit?: number;
};

export type EmptiesDepositBalanceListPage = {
  items: EmptiesDepositBalanceDto[];
  totals: { heldKobo: string; customersHolding: number };
  holdingAccount: { id: string | null; balanceKobo: string };
  nextCursor: string | null;
};

export type EmptiesDepositDto = {
  id: string;
  customerId: string;
  customerName: string;
  movementType: EmptiesDepositMovementType;
  amountKobo: string;
  note: string | null;
  occurredAt: string;
  createdById: string;
  accountEntryId: string | null;
  accountTransferId: string | null;
  customerMovementId: string | null;
  crateQuantity: number | null;
  crateLabel: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  createdAt: string;
};

export type EmptiesDepositListOptions = {
  from?: string;
  to?: string;
  customerId?: string;
  cursor?: string | null;
  limit?: number;
};

export type EmptiesDepositListPage = {
  items: EmptiesDepositDto[];
  nextCursor: string | null;
  from: string | null;
  to: string | null;
};

export type CreateEmptiesDepositInput = {
  customerId: string;
  movementType: EmptiesDepositMovementType;
  amountKobo: string;
  note?: string | null;
  occurredAt?: string;
  /** Forfeit only: the crates written off and the main account that receives the money. */
  typeId?: string;
  quantity?: number;
  toAccountId?: string;
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

export type CreateEmptiesCustomerMovementInput = {
  customerId: string;
  typeId: string;
  movementType: EmptiesCustomerMovementType;
  /** Positive for typed movements; signed for ADJUSTMENT. */
  quantity: number;
  note?: string | null;
  occurredAt?: string;
};

export interface EmptiesApi {
  getOverview(): Promise<EmptiesOverviewDto>;
  listProductOwners(options?: ProductOwnerListOptions): Promise<ProductOwnerListPage>;
  assignProductOwner(
    productId: string,
    ownerId: string | null,
    idempotencyKey?: string,
  ): Promise<ProductOwnerDto>;

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
  listCustomerBalances(
    options?: EmptiesCustomerBalanceListOptions,
  ): Promise<EmptiesCustomerBalanceListPage>;
  listCustomerMovements(
    options?: EmptiesCustomerMovementListOptions,
  ): Promise<EmptiesCustomerMovementListPage>;
  createCustomerMovement(
    input: CreateEmptiesCustomerMovementInput,
    idempotencyKey?: string,
  ): Promise<EmptiesCustomerMovementDto>;
  reverseCustomerMovement(
    id: string,
    reason: string,
    idempotencyKey?: string,
  ): Promise<EmptiesCustomerMovementDto>;
  listDepositBalances(
    options?: EmptiesDepositBalanceListOptions,
  ): Promise<EmptiesDepositBalanceListPage>;
  listDeposits(options?: EmptiesDepositListOptions): Promise<EmptiesDepositListPage>;
  createDeposit(input: CreateEmptiesDepositInput, idempotencyKey?: string): Promise<EmptiesDepositDto>;
  reverseDeposit(id: string, reason: string, idempotencyKey?: string): Promise<EmptiesDepositDto>;
}
