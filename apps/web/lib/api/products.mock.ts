import {
  createProductDtoSchema,
  fromAuditLogDto,
  toAuditLogDto,
  toProductDto,
  type CreateProductDto,
  type Product,
  type ProductDto,
} from "@fabtyna/shared";
import type { ProductsApi, ProductListOptions } from "./products.api";
import { readMockStore, transactMockStore } from "./mock-store";

function delay(): Promise<void> {
  const milliseconds = 150 + Math.floor(Math.random() * 151);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(product: Product): ProductDto {
  return jsonClone(toProductDto(product));
}

function validated(input: CreateProductDto): CreateProductDto {
  return createProductDtoSchema.parse(input);
}

function assertUniqueSku(
  products: Product[],
  sku: string | null,
  exceptId?: string,
): void {
  if (sku === null || sku.trim() === "") return;
  const normalized = sku.trim().toLocaleLowerCase();
  const duplicate = products.find(
    (product) =>
      product.id !== exceptId &&
      product.deletedAt === null &&
      product.sku?.trim().toLocaleLowerCase() === normalized,
  );
  if (duplicate) {
    throw new Error(`SKU '${sku}' is already used by an active product.`);
  }
}

function findProduct(products: Product[], id: string): Product {
  const product = products.find((item) => item.id === id);
  if (!product) throw new Error("Product not found.");
  return product;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  productId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  const entry = {
    id: crypto.randomUUID(),
    actorId: null,
    action,
    entityType: "Product",
    entityId: productId,
    beforeData,
    afterData,
    metadata: null,
    occurredAt: new Date(),
  };
  draft.auditLogs.push(fromAuditLogDto(toAuditLogDto(entry)));
}

export const productsMockApi: ProductsApi = {
  async list(options: ProductListOptions = {}) {
    await delay();
    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const rows = readMockStore().products.filter((product) => {
      if (!options.includeDeleted && product.deletedAt !== null) return false;
      if (options.includeDeleted && product.deletedAt === null) return false;
      if (!search) return true;
      return (
        product.name.toLocaleLowerCase().includes(search) ||
        product.sku?.toLocaleLowerCase().includes(search) === true
      );
    });
    return jsonClone(rows.map(toProductDto));
  },

  async create(input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      assertUniqueSku(draft.products, data.sku);
      const createdAt = new Date();
      const product: Product = {
        id: crypto.randomUUID(),
        ...data,
        sku: data.sku?.trim() || null,
        retailPriceKobo: BigInt(data.retailPriceKobo),
        wholesalePriceKobo: BigInt(data.wholesalePriceKobo),
        averageCostKobo: 0n,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      draft.products.push(product);
      audit(draft, "PRODUCT_CREATED", product.id, null, toProductDto(product));
      return product;
    });
    return response(result);
  },

  async update(id, input) {
    await delay();
    const data = validated(input);
    const result = transactMockStore((draft) => {
      const product = findProduct(draft.products, id);
      if (product.deletedAt !== null) {
        throw new Error("Restore this product before editing it.");
      }
      assertUniqueSku(draft.products, data.sku, id);
      const before = toProductDto(product);
      Object.assign(product, data, {
        sku: data.sku?.trim() || null,
        retailPriceKobo: BigInt(data.retailPriceKobo),
        wholesalePriceKobo: BigInt(data.wholesalePriceKobo),
        updatedAt: new Date(),
      });
      audit(draft, "PRODUCT_UPDATED", id, before, toProductDto(product));
      return product;
    });
    return response(result);
  },

  async softDelete(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const product = findProduct(draft.products, id);
      if (product.deletedAt !== null) throw new Error("Product is already deleted.");
      const before = toProductDto(product);
      product.deletedAt = new Date();
      product.updatedAt = product.deletedAt;
      audit(draft, "PRODUCT_SOFT_DELETED", id, before, toProductDto(product));
      return product;
    });
    return response(result);
  },

  async restore(id) {
    await delay();
    const result = transactMockStore((draft) => {
      const product = findProduct(draft.products, id);
      if (product.deletedAt === null) throw new Error("Product is already active.");
      assertUniqueSku(draft.products, product.sku, id);
      const before = toProductDto(product);
      product.deletedAt = null;
      product.updatedAt = new Date();
      audit(draft, "PRODUCT_RESTORED", id, before, toProductDto(product));
      return product;
    });
    return response(result);
  },
};
