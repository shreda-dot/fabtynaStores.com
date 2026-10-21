import type { CreateProductDto } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  CursorPage,
  ProductDetailDto,
  ProductListOptions,
  ProductRecordDto,
  ProductsApi,
} from "./products.api";

type ProductWire = Omit<ProductRecordDto, "deletedAt"> & {
  deletedAt?: string | null;
};

function mapProduct(product: ProductWire): ProductRecordDto {
  return { ...product, deletedAt: product.deletedAt ?? null };
}

function queryString(options: ProductListOptions): string {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("q", options.search.trim());
  query.set("active", options.includeDeleted ? "false" : "true");
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  return `?${query.toString()}`;
}

export const productsRealApi: ProductsApi = {
  async list(options = {}) {
    return (await this.listPage(options)).items;
  },
  async listPage(options = {}) {
    const page = await requestJson<CursorPage<ProductWire>>(`/products${queryString(options)}`);
    return { ...page, items: page.items.map(mapProduct) };
  },
  async getById(id) {
    const detail = await requestJson<Omit<ProductDetailDto, "deletedAt"> & { deletedAt?: string | null }>(
      `/products/${encodeURIComponent(id)}`,
    );
    return {
      ...mapProduct(detail),
      movements: detail.movements,
      hasStockMovement: detail.movements.length > 0,
    };
  },
  async create(input: CreateProductDto, idempotencyKey) {
    return mapProduct(await requestJson<ProductWire>("/products", {
      method: "POST",
      body: input,
      idempotencyKey,
    }));
  },
  async update(id, input, idempotencyKey) {
    return mapProduct(await requestJson<ProductWire>(`/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
      idempotencyKey,
    }));
  },
  async softDelete(id, idempotencyKey) {
    return mapProduct(await requestJson<ProductWire>(
      `/products/${encodeURIComponent(id)}/deactivate`,
      { method: "POST", idempotencyKey },
    ));
  },
  async restore(id, idempotencyKey) {
    return mapProduct(await requestJson<ProductWire>(
      `/products/${encodeURIComponent(id)}/reactivate`,
      { method: "POST", idempotencyKey },
    ));
  },
};
