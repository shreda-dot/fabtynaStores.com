import type { FastifyServerOptions } from "fastify";

/**
 * Anything that must never reach a log line. Fastify's default request
 * serializer logs only method, url, host and remote address, so these paths are
 * a second line of defence: they hold if someone later logs headers or a body
 * (for example `request.log.info({ req, body })`).
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "headers.cookie",
  "headers.authorization",
  'headers["set-cookie"]',
  "body.password",
  "body.currentPassword",
  "body.newPassword",
  "body.passwordHash",
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.passwordHash",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.passwordHash",
];

export type LoggerOption = NonNullable<FastifyServerOptions["logger"]>;

export function buildLoggerOptions(extra: { stream?: { write: (line: string) => void } } = {}): LoggerOption {
  return {
    redact: { paths: [...LOG_REDACT_PATHS], censor: "[Redacted]" },
    ...(extra.stream === undefined ? {} : { stream: extra.stream }),
  } as LoggerOption;
}
