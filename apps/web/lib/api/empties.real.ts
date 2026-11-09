import { requestJson } from "./client";
import type {
  EmptiesApi,
  EmptiesBalanceListOptions,
  EmptiesBalancesDto,
  EmptiesOverviewDto,
  EmptiesMovementDto,
  EmptiesMovementListOptions,
  EmptiesMovementListPage,
  EmptiesOwnerDto,
  EmptiesOwnerListOptions,
  ProductOwnerListOptions,
  ProductOwnerListPage,
  ProductOwnerDto,
  EmptiesTypeDto,
  EmptiesTypeListOptions,
  EmptiesCustomerBalanceListOptions,
  EmptiesCustomerBalanceListPage,
  EmptiesCustomerMovementListOptions,
  EmptiesCustomerMovementListPage,
  EmptiesCustomerMovementDto,
  CreateEmptiesCustomerMovementInput,
  EmptiesDepositBalanceListOptions,
  EmptiesDepositBalanceListPage,
  EmptiesDepositListOptions,
  EmptiesDepositListPage,
  EmptiesDepositDto,
  CreateEmptiesDepositInput,
  EmptiesProductPackagingInput,
} from "./empties.api";

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(name, value);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function ownersQuery(options: EmptiesOwnerListOptions = {}): string {
  return query({ includeInactive: options.includeInactive ? "true" : "false" });
}

export function typesQuery(options: EmptiesTypeListOptions = {}): string {
  return query({
    includeInactive: options.includeInactive ? "true" : undefined,
    ownerId: options.ownerId,
  });
}

export function balancesQuery(options: EmptiesBalanceListOptions = {}): string {
  return query({ includeInactive: options.includeInactive ? "true" : undefined });
}

export function movementsQuery(options: EmptiesMovementListOptions = {}): string {
  return query({
    from: options.from,
    to: options.to,
    typeId: options.typeId,
    ownerId: options.ownerId,
    cursor: options.cursor ?? undefined,
    limit: String(options.limit ?? 50),
  });
}

export function productOwnersQuery(options: ProductOwnerListOptions = {}): string {
  return query({
    q: nonEmpty(options.q),
    assigned: options.assigned === undefined || options.assigned === "all" ? undefined : options.assigned,
    cursor: options.cursor ?? undefined,
    limit: options.limit === undefined ? undefined : String(options.limit),
  });
}

export function customerBalancesQuery(
  options: EmptiesCustomerBalanceListOptions = {},
): string {
  return query({
    customerId: options.customerId,
    ownerId: options.ownerId,
    typeId: options.typeId,
    q: nonEmpty(options.q),
    onlyOwing: String(options.onlyOwing ?? true),
    cursor: options.cursor ?? undefined,
    limit: String(options.limit ?? 50),
  });
}

export function customerMovementsQuery(
  options: EmptiesCustomerMovementListOptions = {},
): string {
  return query({
    from: options.from,
    to: options.to,
    customerId: options.customerId,
    typeId: options.typeId,
    cursor: options.cursor ?? undefined,
    limit: String(options.limit ?? 50),
  });
}

export function depositBalancesQuery(options: EmptiesDepositBalanceListOptions = {}): string {
  return query({
    q: nonEmpty(options.q),
    onlyHolding: String(options.onlyHolding ?? true),
    cursor: options.cursor ?? undefined,
    limit: String(options.limit ?? 50),
  });
}

export function depositsQuery(options: EmptiesDepositListOptions = {}): string {
  return query({
    from: options.from,
    to: options.to,
    customerId: options.customerId,
    cursor: options.cursor ?? undefined,
    limit: String(options.limit ?? 50),
  });
}

export const emptiesRealApi: EmptiesApi = {
  async getOverview() {
    return requestJson<EmptiesOverviewDto>("/empties/overview");
  },

  async listProductOwners(options = {}) {
    return requestJson<ProductOwnerListPage>(
      `/empties/product-owners${productOwnersQuery(options)}`,
    );
  },

  async assignProductOwner(productId, ownerId, idempotencyKey) {
    return requestJson<ProductOwnerDto>(
      `/empties/product-owners/${encodeURIComponent(productId)}`,
      { method: "PUT", body: { ownerId }, idempotencyKey },
    );
  },

  async assignProductPackaging(productId, input: EmptiesProductPackagingInput, idempotencyKey) {
    return requestJson(
      `/empties/products/${encodeURIComponent(productId)}/packaging`,
      { method: "PUT", body: input, idempotencyKey },
    );
  },

  async listOwners(options = {}) {
    return requestJson<EmptiesOwnerDto[]>(`/empties/owners${ownersQuery(options)}`);
  },

  async createOwner(input, idempotencyKey) {
    return requestJson<EmptiesOwnerDto>("/empties/owners", {
      method: "POST",
      body: { name: input.name },
      idempotencyKey,
    });
  },

  async renameOwner(id, name, idempotencyKey) {
    return requestJson<EmptiesOwnerDto>(`/empties/owners/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { name },
      idempotencyKey,
    });
  },

  async setOwnerActive(id, isActive, idempotencyKey) {
    return requestJson<EmptiesOwnerDto>(
      `/empties/owners/${encodeURIComponent(id)}/${isActive ? "reactivate" : "deactivate"}`,
      { method: "POST", idempotencyKey },
    );
  },

  async listTypes(options = {}) {
    return requestJson<EmptiesTypeDto[]>(`/empties/types${typesQuery(options)}`);
  },

  async createType(input, idempotencyKey) {
    const unitValueKobo = input.unitValueKobo ?? undefined;
    return requestJson<EmptiesTypeDto>("/empties/types", {
      method: "POST",
      body: {
        ownerId: input.ownerId,
        kind: input.kind,
        label: input.label,
        ...(unitValueKobo === undefined ? {} : { unitValueKobo }),
      },
      idempotencyKey,
    });
  },

  async patchType(id, input, idempotencyKey) {
    return requestJson<EmptiesTypeDto>(`/empties/types/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.unitValueKobo === undefined ? {} : { unitValueKobo: input.unitValueKobo }),
      },
      idempotencyKey,
    });
  },

  async setTypeActive(id, isActive, idempotencyKey) {
    return requestJson<EmptiesTypeDto>(
      `/empties/types/${encodeURIComponent(id)}/${isActive ? "reactivate" : "deactivate"}`,
      { method: "POST", idempotencyKey },
    );
  },

  async listBalances(options = {}) {
    return requestJson<EmptiesBalancesDto>(`/empties/balances${balancesQuery(options)}`);
  },

  async listMovements(options = {}) {
    const page = await requestJson<{
      items: EmptiesMovementDto[];
      nextCursor?: string | null;
      from?: string | null;
      to?: string | null;
    }>(`/empties/movements${movementsQuery(options)}`);
    const result: EmptiesMovementListPage = {
      items: page.items,
      nextCursor: page.nextCursor ?? null,
      from: page.from ?? null,
      to: page.to ?? null,
    };
    return result;
  },

  async createMovement(input, idempotencyKey) {
    const note = nonEmpty(input.note);
    return requestJson<EmptiesMovementDto>("/empties/movements", {
      method: "POST",
      body: {
        typeId: input.typeId,
        movementType: input.movementType,
        quantity: input.quantity,
        ...(note === undefined ? {} : { note }),
        ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
      },
      idempotencyKey,
    });
  },

  async reverseMovement(id, reason, idempotencyKey) {
    return requestJson<EmptiesMovementDto>(
      `/empties/movements/${encodeURIComponent(id)}/reverse`,
      { method: "POST", body: { reason }, idempotencyKey },
    );
  },

  async listCustomerBalances(options = {}) {
    return requestJson<EmptiesCustomerBalanceListPage>(
      `/empties/customer-balances${customerBalancesQuery(options)}`,
    );
  },

  async listCustomerMovements(options = {}) {
    return requestJson<EmptiesCustomerMovementListPage>(
      `/empties/customer-movements${customerMovementsQuery(options)}`,
    );
  },

  async createCustomerMovement(input: CreateEmptiesCustomerMovementInput, idempotencyKey) {
    return requestJson<EmptiesCustomerMovementDto>("/empties/customer-movements", {
      method: "POST",
      body: {
        customerId: input.customerId,
        typeId: input.typeId,
        movementType: input.movementType,
        quantity: input.quantity,
        ...(nonEmpty(input.note) === undefined ? {} : { note: nonEmpty(input.note) }),
        ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
      },
      idempotencyKey,
    });
  },

  async reverseCustomerMovement(id, reason, idempotencyKey) {
    return requestJson<EmptiesCustomerMovementDto>(
      `/empties/customer-movements/${encodeURIComponent(id)}/reverse`,
      { method: "POST", body: { reason }, idempotencyKey },
    );
  },

  async listDepositBalances(options = {}) {
    return requestJson<EmptiesDepositBalanceListPage>(
      `/empties/deposit-balances${depositBalancesQuery(options)}`,
    );
  },

  async listDeposits(options = {}) {
    return requestJson<EmptiesDepositListPage>(`/empties/deposits${depositsQuery(options)}`);
  },

  async createDeposit(input: CreateEmptiesDepositInput, idempotencyKey) {
    return requestJson<EmptiesDepositDto>("/empties/deposits", {
      method: "POST",
      body: {
        customerId: input.customerId,
        movementType: input.movementType,
        amountKobo: input.amountKobo,
        ...(nonEmpty(input.note) === undefined ? {} : { note: nonEmpty(input.note) }),
        ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
        ...(input.typeId === undefined ? {} : { typeId: input.typeId }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.toAccountId === undefined ? {} : { toAccountId: input.toAccountId }),
      },
      idempotencyKey,
    });
  },

  async reverseDeposit(id, reason, idempotencyKey) {
    return requestJson<EmptiesDepositDto>(`/empties/deposits/${encodeURIComponent(id)}/reverse`, {
      method: "POST",
      body: { reason },
      idempotencyKey,
    });
  },
};
