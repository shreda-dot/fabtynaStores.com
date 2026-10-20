import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RuntimeEnv } from "../lib/env.js";

/**
 * TEMPORARY, FAIL-CLOSED STAND-IN FOR LOGIN.
 *
 * There is no authentication yet. Until there is, the API may only run:
 *   - outside production (`NODE_ENV=production` refuses to start at all);
 *   - when `ALLOW_UNAUTHENTICATED_DEV=true` is set explicitly;
 *   - listening on 127.0.0.1 only (enforced in `start.ts`);
 *   - acting as one named, active admin (`DEV_ACTOR_EMAIL`).
 *
 * THE ONE PLACE REAL AUTH REPLACES: `ActorResolver`. Every route asks
 * `resolveActor(request)` who is calling and gets an `Actor`; nothing else in
 * the codebase knows about this guard. Real login supplies a different resolver
 * (verify the session/JWT, load the admin) and `assertUnauthenticatedModeAllowed`
 * and `loadDevActor` are deleted.
 */

export interface Actor {
  id: string;
  email: string;
}

export type ActorResolver = (request: unknown) => Promise<Actor>;

export function assertUnauthenticatedModeAllowed(
  env: Pick<RuntimeEnv, "nodeEnv" | "allowUnauthenticatedDev">,
): void {
  if (env.nodeEnv === "production") {
    throw new Error(
      "Refusing to start: NODE_ENV=production but real authentication does not exist yet. " +
        "The API only runs unauthenticated in development.",
    );
  }
  if (!env.allowUnauthenticatedDev) {
    throw new Error(
      "Refusing to start: there is no authentication yet. Set ALLOW_UNAUTHENTICATED_DEV=true " +
        "to run the API unauthenticated on localhost for development.",
    );
  }
}

/** Looks up the admin `DEV_ACTOR_EMAIL` names; it must exist and be active. */
export async function loadDevActor(
  prisma: PrismaClient,
  email: string | null,
): Promise<Actor> {
  if (email === null) {
    throw new Error("Refusing to start: DEV_ACTOR_EMAIL is not set.");
  }
  const admin = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, email: true, isActive: true },
  });
  if (admin === null) {
    throw new Error("Refusing to start: DEV_ACTOR_EMAIL does not match any admin user.");
  }
  if (!admin.isActive) {
    throw new Error("Refusing to start: the DEV_ACTOR_EMAIL admin is deactivated.");
  }
  return { id: admin.id, email: admin.email };
}

export function createDevActorResolver(actor: Actor): ActorResolver {
  return async () => actor;
}
