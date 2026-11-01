CREATE TABLE empties_product_owners (
    "productId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empties_product_owners_pkey" PRIMARY KEY ("productId"),
    CONSTRAINT "fk_empties_product_owners_product"
      FOREIGN KEY ("productId") REFERENCES products ("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_empties_product_owners_owner"
      FOREIGN KEY ("ownerId") REFERENCES empties_owners ("id") ON DELETE RESTRICT
);

CREATE INDEX "empties_product_owners_ownerId_idx"
  ON empties_product_owners ("ownerId");
