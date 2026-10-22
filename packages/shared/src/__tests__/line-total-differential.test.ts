import { describe, expect, it } from "vitest";
import { computeSaleLineTotalKobo, parseQuantityText } from "../domain/operations.ts";

// TEST-ONLY copy of the rounding recordSale used before computeSaleLineTotalKobo
// was extracted (commit 3d2a584~1, operations.ts: roundHalfUp(scaledQuantity * price, 10^4)).
function oldRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) {
    return -oldRoundHalfUp(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
}

function oldLineTotal(scaledQuantity: bigint, unitPriceKobo: bigint): bigint {
  return oldRoundHalfUp(scaledQuantity * unitPriceKobo, 10n ** 4n);
}

// Deterministic generator so a failure is reproducible.
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomBigInt(random: () => number, maxExclusive: number): bigint {
  return BigInt(Math.floor(random() * maxExclusive));
}

function formatScaled(scaled: bigint): string {
  const whole = scaled / 10000n;
  const fraction = (scaled % 10000n).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

describe("computeSaleLineTotalKobo vs the old rounding", () => {
  it("matches over 12,000 generated (quantity, price) pairs, including exact halves", () => {
    const random = makeRandom(20261021);
    let compared = 0;
    let exactHalves = 0;

    for (let i = 0; i < 12000; i += 1) {
      let scaledQuantity: bigint;
      let price: bigint;
      if (i % 4 === 0) {
        // Exact half: scaled * price = 5000 (mod 10000), built from an odd k and an odd price.
        const k = randomBigInt(random, 5000) * 2n + 1n;
        scaledQuantity = 5000n * k;
        price = randomBigInt(random, 50_000_000) * 2n + 1n;
        exactHalves += 1;
      } else {
        scaledQuantity = randomBigInt(random, 100_000_000) + 1n;
        price = randomBigInt(random, 100_000_000_000);
      }

      const text = formatScaled(scaledQuantity);
      const parsed = parseQuantityText(text);
      if (!parsed.ok) {
        // Very large quantities may be refused as too precise for a JSON number; that is the intended guard.
        continue;
      }
      expect(parsed.scaledQuantity).toBe(scaledQuantity);

      const expected = oldLineTotal(scaledQuantity, price);
      expect(computeSaleLineTotalKobo(scaledQuantity, price)).toBe(expected);
      if ((scaledQuantity * price) % 10000n === 5000n) {
        expect(expected).toBe((scaledQuantity * price + 5000n) / 10000n);
      }
      compared += 1;
    }

    expect(compared).toBeGreaterThanOrEqual(10000);
    expect(exactHalves).toBeGreaterThanOrEqual(3000);
  });

  it("592.05 x 50769390 rounds the .5 up to ...350", () => {
    const parsed = parseQuantityText("592.05");
    if (!parsed.ok) throw new Error(parsed.message);
    expect(oldLineTotal(parsed.scaledQuantity, 50769390n)).toBe(30058017350n);
    expect(computeSaleLineTotalKobo(parsed.scaledQuantity, 50769390n)).toBe(30058017350n);
  });
});
