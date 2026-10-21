import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

export interface Actor {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
    adminSessionId: string | null;
  }
}

export function requireActor(request: FastifyRequest): Actor {
  if (request.actor === null) {
    throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  return request.actor;
}
