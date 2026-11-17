import type { Unit } from "@fabtyna/shared";

export type EmptiesKind = "BOTTLE" | "CRATE";

export type EmptiesMovementType =
  | "OPENING"
  | "RECEIVED"
  | "RETURNED_TO_OWNER"
  | "ISSUED_TO_CUSTOMER"
  | "ADJUSTMENT";

export type CreateEmptiesMovementType = Exclude<EmptiesMovementType, "ISSUED_TO_CUSTOMER">;

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
  capacity: number | null;
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
  /** Sale whose containers were automatically recorded as returned. */
  saleId: string | null;
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
  capacity: number | null;
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
  totalsByOwner: Array<EmptiesBalanceTotalsDto & { ownerId: string; ownerName: string; kind: EmptiesKind }>;
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
  sizeClasses: Array<{
    typeId: string;
    capacity: number;
    label: string;
    stockBottles: number;
    emptyBottles: number;
    emptyCrates: number;
    looseEmptyBottles: number;
    totalBottles: number;
    totalCrates: number;
    looseTotalBottles: number;
  }>;
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
    productsWithoutConfirmedSize: EmptiesStockWarningDto[];
  };
};

export type SizeClassRecountDto = {
  phase: "LEGACY" | "RECOUNT_PENDING" | "READY";
  classes: Array<{
    typeId: string;
    ownerId: string;
    ownerName: string;
    label: string;
    capacity: number;
    quantity: number;
  }>;
};

export type SizeClassRecountInput = {
  counts: Array<{
    typeId: string;
    emptyCrates: number;
    looseBottles: number;
  }>;
  reason: string;
};

export type ProductOwnerDto = {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
  packaging: Array<{
    typeId: string;
    kind: EmptiesKind;
    label: string;
    retailQuantityPerUnit: number;
    wholesaleQuantityPerPack: number;
  }>;
};

export type EmptiesProductPackagingInput = {
  mappings: Array<{
    typeId: string;
    kind: EmptiesKind;
    retailQuantityPerUnit: number;
    wholesaleQuantityPerPack: number;
  }>;
};

export type PurchaseEmptiesSetupMapping = {
  typeId: string;
  kind: EmptiesKind;
  label: string;
  countPerUnit: number | null;
  countPerPack: number | null;
  cratesPerPack: number | null;
  capacity: number | null;
};

export type PurchaseEmptiesSetupItem = {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  isActive: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
  classification: "RETURNABLE" | "NON_RETURNABLE" | null;
  mappings: PurchaseEmptiesSetupMapping[];
  salePackagingSuggestions: Array<{
    typeId: string;
    kind: EmptiesKind;
    label: string;
    retailQuantityPerUnit: number;
    wholesaleQuantityPerPack: number;
  }>;
};

export type PurchaseEmptiesSetupPage = {
  items: PurchaseEmptiesSetupItem[];
  nextCursor: string | null;
};

export type PurchaseEmptiesSetupInput = {
  classification: "RETURNABLE" | "NON_RETURNABLE";
  mappings: Array<
    | { kind: "CRATE"; typeId: string; countPerPack: number }
    | { kind: "BOTTLE"; typeId: string; countPerUnit: number; cratesPerPack?: number | null }
  >;
};

export type SupplierEmptiesDebtDto = {
  id: string;
  supplierId: string;
  supplierName: string;
  typeId: string;
  ownerName: string;
  kind: EmptiesKind;
  typeLabel: string;
  purchaseId: string | null;
  purchaseReference: string | null;
  originalQuantity: number;
  quantity: number;
  createdAt: string;
};

export type SupplierEmptiesDebtPage = {
  items: SupplierEmptiesDebtDto[];
  nextCursor: string | null;
};

export type SupplierEmptiesSettlementDto = {
  id: string;
  supplierId: string | null;
  typeId: string;
  kind: EmptiesKind;
  label: string;
  purchaseId: string | null;
  obligationId: string | null;
  quantity: number;
  note: string | null;
  occurredAt: string;
  reversed: boolean;
};

export type SupplierEmptiesSettlementPage = {
  items: SupplierEmptiesSettlementDto[];
  nextCursor: string | null;
};

export type SupplierEmptiesListOptions = {
  supplierId?: string;
  typeId?: string;
  includeSettled?: boolean;
  cursor?: string | null;
  limit?: number;
};

export type PurchaseEmptiesPreviewInput = {
  lines: Array<{
    productId: string;
    unit: Unit;
    quantity: number;
    emptiesCrateCount?: number;
  }>;
  amendingPurchaseId?: string;
};

export type PurchaseEmptiesPreviewDto = {
  lines: Array<{
    index: number;
    requirements: Array<{
      typeId: string;
      kind: EmptiesKind;
      quantity: number;
      manualCrateCount: boolean;
      suggestedCrateCount: number | null;
    }>;
  }>;
  totals: Array<{
    typeId: string;
    kind: EmptiesKind;
    label: string;
    required: number;
    available: number;
    shortage: number;
  }>;
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
    kind: EmptiesKind;
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
  capacity?: 12 | 20 | 24 | null;
  unitValueKobo?: string | null;
};

export type PatchEmptiesTypeInput = {
  label?: string;
  unitValueKobo?: string | null;
};

export type CreateEmptiesMovementInput = {
  typeId: string;
  movementType: CreateEmptiesMovementType;
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
  getSizeClassRecount(): Promise<SizeClassRecountDto>;
  beginSizeClassRecount(idempotencyKey?: string): Promise<{ phase: "RECOUNT_PENDING" }>;
  submitSizeClassRecount(
    input: SizeClassRecountInput,
    idempotencyKey?: string,
  ): Promise<{ phase: "READY"; changes: Array<{
    typeId: string;
    ownerName: string;
    label: string;
    capacity: number;
    previousBottles: number;
    countedBottles: number;
    delta: number;
    movementId: string | null;
  }> }>;
  listProductOwners(options?: ProductOwnerListOptions): Promise<ProductOwnerListPage>;
  assignProductOwner(
    productId: string,
    ownerId: string | null,
    idempotencyKey?: string,
  ): Promise<ProductOwnerDto>;
  assignProductPackaging(
    productId: string,
    input: EmptiesProductPackagingInput,
    idempotencyKey?: string,
  ): Promise<unknown>;
  listPurchaseSetup(options?: { cursor?: string | null; limit?: number }): Promise<PurchaseEmptiesSetupPage>;
  setPurchaseSetup(
    productId: string,
    input: PurchaseEmptiesSetupInput,
    idempotencyKey?: string,
  ): Promise<unknown>;
  listSupplierDebts(options?: SupplierEmptiesListOptions): Promise<SupplierEmptiesDebtPage>;
  listSupplierSettlements(options?: SupplierEmptiesListOptions & { obligationId?: string }): Promise<SupplierEmptiesSettlementPage>;
  createOpeningSupplierDebt(
    input: { supplierId: string; typeId: string; quantity: number; note: string },
    idempotencyKey?: string,
  ): Promise<unknown>;
  settleSupplierDebt(
    input: {
      supplierId: string;
      typeId: string;
      quantity: number;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<unknown>;
  reverseSupplierSettlement(id: string, reason: string, idempotencyKey?: string): Promise<unknown>;

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
