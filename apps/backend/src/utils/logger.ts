import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers[\"set-cookie\"]", "*.password", "*.passwordHash"],
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
});
