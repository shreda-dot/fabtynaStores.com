import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireActor } from "../../auth/actor.js";
import { validationError } from "../../lib/errors.js";
import {
  addLoanChargeDtoSchema,
  createLoanDtoSchema,
  idempotencyKeySchema,
  listLoansQuerySchema,
  loanIdParamsSchema,
  recordLoanRepaymentDtoSchema,
  zodIssues,
} from "./loans.schemas.js";
import type { LoanResponse, LoansService } from "./loans.service.js";

function readIdempotencyKey(request: FastifyRequest): string | null {
  const rawKey = request.headers["idempotency-key"];
  if (rawKey === undefined) return null;
  const parsed = idempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid Idempotency-Key.", {
      header: "Idempotency-Key",
    });
  }
  return parsed.data;
}

function readLoanId(request: FastifyRequest): string {
  const parsed = loanIdParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw validationError("Invalid loan id.", zodIssues(parsed.error));
  }
  return parsed.data.id;
}

function send(reply: FastifyReply, result: LoanResponse) {
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return reply.status(result.status).send(result.body);
}

export function registerLoansRoutes(
  app: FastifyInstance,
  deps: { service: LoansService },
): void {
  app.post("/loans", async (request, reply) => {
    const actor = requireActor(request);
    const parsed = createLoanDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The loan is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.createLoan(parsed.data, actor, readIdempotencyKey(request)));
  });

  app.post("/loans/:id/charges", async (request, reply) => {
    const actor = requireActor(request);
    const loanId = readLoanId(request);
    const parsed = addLoanChargeDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The charge is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.addCharge(loanId, parsed.data, actor, readIdempotencyKey(request)));
  });

  app.post("/loans/:id/repayments", async (request, reply) => {
    const actor = requireActor(request);
    const loanId = readLoanId(request);
    const parsed = recordLoanRepaymentDtoSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError("The repayment is not valid.", zodIssues(parsed.error));
    }
    return send(reply, await deps.service.recordRepayment(loanId, parsed.data, actor, readIdempotencyKey(request)));
  });

  app.get("/loans", async (request, reply) => {
    requireActor(request);
    const parsed = listLoansQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw validationError("The loans filter is not valid.", zodIssues(parsed.error));
    }
    return reply.status(200).send(await deps.service.listLoans(parsed.data));
  });

  app.get("/loans/:id", async (request, reply) => {
    requireActor(request);
    return reply.status(200).send(await deps.service.getLoan(readLoanId(request)));
  });
}
