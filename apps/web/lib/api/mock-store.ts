import {
  fromAuditLogDto,
  fromProductDto,
  fromPurchaseDto,
  fromPurchaseLineDto,
  fromStockAdjustmentDto,
  fromStockAdjustmentLineDto,
  fromStockMovementDto,
  fromStockTransferDto,
  fromStockTransferLegDto,
  fromStockTransferLineDto,
  fromSupplierDto,
  fromSupplierLedgerEntryDto,
  toAuditLogDto,
  toProductDto,
  toPurchaseDto,
  toPurchaseLineDto,
  toStockAdjustmentDto,
  toStockAdjustmentLineDto,
  toStockMovementDto,
  toStockTransferDto,
  toStockTransferLegDto,
  toStockTransferLineDto,
  toSupplierDto,
  toSupplierLedgerEntryDto,
  type AuditLog,
  type Product,
  type Purchase,
  type PurchaseLine,
  type StockAdjustment,
  type StockAdjustmentLine,
  type StockMovement,
  type StockTransfer,
  type StockTransferLeg,
  type StockTransferLine,
  type Supplier,
  type SupplierLedgerEntry,
} from "@fabtyna/shared";
import type {
  AuditLogDto,
  ProductDto,
  PurchaseDto,
  PurchaseLineDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockMovementDto,
  StockTransferDto,
  StockTransferLegDto,
  StockTransferLineDto,
  SupplierDto,
  SupplierLedgerEntryDto,
} from "@fabtyna/shared";

export type MockStore = {
  products: Product[];
  suppliers: Supplier[];
  purchases: Purchase[];
  purchaseLines: PurchaseLine[];
  stockTransfers: StockTransfer[];
  stockTransferLines: StockTransferLine[];
  stockTransferLegs: StockTransferLeg[];
  stockAdjustments: StockAdjustment[];
  stockAdjustmentLines: StockAdjustmentLine[];
  stockMovements: StockMovement[];
  supplierLedgerEntries: SupplierLedgerEntry[];
  auditLogs: AuditLog[];
};

type PersistedMockStore = {
  products: ProductDto[];
  suppliers: SupplierDto[];
  purchases: PurchaseDto[];
  purchaseLines: PurchaseLineDto[];
  stockTransfers: StockTransferDto[];
  stockTransferLines: StockTransferLineDto[];
  stockTransferLegs: StockTransferLegDto[];
  stockAdjustments: StockAdjustmentDto[];
  stockAdjustmentLines: StockAdjustmentLineDto[];
  stockMovements: StockMovementDto[];
  supplierLedgerEntries: SupplierLedgerEntryDto[];
  auditLogs: AuditLogDto[];
};

const STORAGE_KEY = "fabtyna-mock-v1";

function now(): Date {
  return new Date();
}

function seedDemoData(): MockStore {
  const createdAt = now();
  const products: Product[] = [
    ["STAR LAGER", "STAR-CRATE", "BEER", 12, 70000n, 780000n, 61000n, 36],
    ["GULDER", "GULDER-CRATE", "BEER", 12, 75000n, 840000n, 65000n, 36],
    ["HEINEKEN", "HEINEKEN-CRATE", "BEER", 24, 140000n, 3_180_000n, 125000n, 48],
    ["GUINNESS FOREIGN EXTRA", "GUINNESS-CRATE", "BEER", 24, 160000n, 3_650_000n, 145000n, 48],
    ["MALTINA", "MALTINA-CRATE", "SOFT_DRINK", 24, 90000n, 2_050_000n, 78000n, 48],
    ["COCA-COLA", "COKE-CRATE", "SOFT_DRINK", 12, 50000n, 550000n, 42000n, 36],
    ["FANTA", "FANTA-CRATE", "SOFT_DRINK", 12, 50000n, 550000n, 42000n, 36],
    ["SPRITE", "SPRITE-CRATE", "SOFT_DRINK", 12, 50000n, 550000n, 42000n, 36],
  ].map(([name, sku, category, unitsPerPack, retail, wholesale, cost, reorder]) => ({
    id: crypto.randomUUID(),
    name: String(name),
    sku: String(sku),
    category: category as Product["category"],
    packName: "crate",
    unitsPerPack: Number(unitsPerPack),
    retailPriceKobo: BigInt(retail),
    wholesalePriceKobo: BigInt(wholesale),
    averageCostKobo: BigInt(cost),
    reorderLevelUnits: Number(reorder),
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  }));

  const suppliers: Supplier[] = [
    {
      id: crypto.randomUUID(),
      name: "Lagos Beverage Distributors",
      phone: "+234 803 555 0101",
      email: "orders@lagosbeverage.example",
      address: "Ikeja, Lagos",
      notes: "Primary beer supplier",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      name: "West Coast Drinks Ltd",
      phone: "+234 802 555 0182",
      email: "sales@westcoastdrinks.example",
      address: "Apapa, Lagos",
      notes: "Soft drinks and malt",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      name: "Mainland Bottling Supply",
      phone: "+234 809 555 0144",
      email: null,
      address: "Yaba, Lagos",
      notes: null,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  return {
    products,
    suppliers,
    purchases: [],
    purchaseLines: [],
    stockTransfers: [],
    stockTransferLines: [],
    stockTransferLegs: [],
    stockAdjustments: [],
    stockAdjustmentLines: [],
    stockMovements: [],
    supplierLedgerEntries: [],
    auditLogs: [],
  };
}

function encodeStore(store: MockStore): PersistedMockStore {
  return {
    products: store.products.map(toProductDto),
    suppliers: store.suppliers.map(toSupplierDto),
    purchases: store.purchases.map(toPurchaseDto),
    purchaseLines: store.purchaseLines.map(toPurchaseLineDto),
    stockTransfers: store.stockTransfers.map(toStockTransferDto),
    stockTransferLines: store.stockTransferLines.map(toStockTransferLineDto),
    stockTransferLegs: store.stockTransferLegs.map(toStockTransferLegDto),
    stockAdjustments: store.stockAdjustments.map(toStockAdjustmentDto),
    stockAdjustmentLines: store.stockAdjustmentLines.map(toStockAdjustmentLineDto),
    stockMovements: store.stockMovements.map(toStockMovementDto),
    supplierLedgerEntries: store.supplierLedgerEntries.map(toSupplierLedgerEntryDto),
    auditLogs: store.auditLogs.map(toAuditLogDto),
  };
}

function decodeStore(value: unknown): MockStore {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Mock storage must contain an object.");
  }
  const data = value as Record<string, unknown>;
  const requiredKeys = [
    "products",
    "suppliers",
    "purchases",
    "purchaseLines",
    "stockTransfers",
    "stockTransferLines",
    "stockTransferLegs",
    "stockAdjustments",
    "stockAdjustmentLines",
    "stockMovements",
    "supplierLedgerEntries",
    "auditLogs",
  ] as const;
  for (const key of requiredKeys) {
    if (!Array.isArray(data[key])) {
      throw new TypeError(`Mock storage field '${key}' must be an array.`);
    }
  }

  const saved = data as unknown as PersistedMockStore;
  return {
    products: saved.products.map(fromProductDto),
    suppliers: saved.suppliers.map(fromSupplierDto),
    purchases: saved.purchases.map(fromPurchaseDto),
    purchaseLines: saved.purchaseLines.map(fromPurchaseLineDto),
    stockTransfers: saved.stockTransfers.map(fromStockTransferDto),
    stockTransferLines: saved.stockTransferLines.map(fromStockTransferLineDto),
    stockTransferLegs: saved.stockTransferLegs.map(fromStockTransferLegDto),
    stockAdjustments: saved.stockAdjustments.map(fromStockAdjustmentDto),
    stockAdjustmentLines: saved.stockAdjustmentLines.map(fromStockAdjustmentLineDto),
    stockMovements: saved.stockMovements.map(fromStockMovementDto),
    supplierLedgerEntries: saved.supplierLedgerEntries.map(fromSupplierLedgerEntryDto),
    auditLogs: saved.auditLogs.map(fromAuditLogDto),
  };
}

function persist(store: MockStore): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encodeStore(store)));
}

let store: MockStore | null = null;
let loaded = false;

function ensureLoaded(): MockStore {
  if (typeof window === "undefined") {
    throw new Error("The mock API is available only in the browser.");
  }
  if (loaded) {
    if (store === null) throw new Error("Mock store failed to initialize.");
    return store;
  }

  let seeded: MockStore | null = null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === null) {
      seeded = seedDemoData();
    } else {
      try {
        store = decodeStore(JSON.parse(saved) as unknown);
      } catch {
        seeded = seedDemoData();
      }
    }
  } catch {
    seeded = seedDemoData();
  }

  if (seeded !== null) {
    persist(seeded);
    store = seeded;
  }
  loaded = true;
  if (store === null) {
    throw new Error("Mock store failed to initialize.");
  }
  return store;
}

function validateStore(candidate: MockStore): void {
  const activeSkus = new Set<string>();
  for (const product of candidate.products) {
    if (product.deletedAt !== null || product.sku === null) continue;
    const normalizedSku = product.sku.trim().toLocaleLowerCase();
    if (normalizedSku === "") continue;
    if (activeSkus.has(normalizedSku)) {
      throw new Error(`SKU '${product.sku}' is already used by an active product.`);
    }
    activeSkus.add(normalizedSku);
  }
}

export function transactMockStore<T>(change: (draft: MockStore) => T): T {
  const current = ensureLoaded();
  const draft = structuredClone(current);
  const result = change(draft);
  validateStore(draft);
  persist(draft);
  store = draft;
  return structuredClone(result);
}

export function readMockStore(): MockStore {
  return structuredClone(ensureLoaded());
}

export function resetDemoData(): void {
  const fresh = seedDemoData();
  persist(fresh);
  store = fresh;
  loaded = true;
}
