import type { EmptiesApi } from "./empties.api";

const MESSAGE = "Empties tracking is not available with demo data.";

function notAvailable(): never {
  throw new Error(MESSAGE);
}

/**
 * Empties needs the real server: counts are only meaningful against the live
 * ledger, so the demo build shows a "Not available with demo data" panel
 * instead of a parallel fake. Every call therefore refuses.
 */
export const emptiesMockApi: EmptiesApi = {
  listOwners: async () => notAvailable(),
  createOwner: async () => notAvailable(),
  renameOwner: async () => notAvailable(),
  setOwnerActive: async () => notAvailable(),
  listTypes: async () => notAvailable(),
  createType: async () => notAvailable(),
  patchType: async () => notAvailable(),
  setTypeActive: async () => notAvailable(),
  listBalances: async () => notAvailable(),
  listMovements: async () => notAvailable(),
  createMovement: async () => notAvailable(),
  reverseMovement: async () => notAvailable(),
};
