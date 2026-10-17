/**
 * Structured JSON logs (Cloud Logging reads one JSON object per line).
 * Only request ids, routes and outcome codes: never complaint text, voice notes,
 * Testimony drafts or any request body (spec 00, UU 27/2022).
 */
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function write(severity: string, message: string, fields: LogFields = {}) {
  process.stdout.write(`${JSON.stringify({ severity, message, ...fields })}\n`);
}

export const logger: Logger = {
  info: (message, fields) => write("INFO", message, fields),
  warn: (message, fields) => write("WARNING", message, fields),
  error: (message, fields) => write("ERROR", message, fields),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** A logger that adds the same fields (the request id) to every line. */
export function withFields(base: Logger, fixed: LogFields): Logger {
  return {
    info: (message, fields) => base.info(message, { ...fixed, ...fields }),
    warn: (message, fields) => base.warn(message, { ...fixed, ...fields }),
    error: (message, fields) => base.error(message, { ...fixed, ...fields }),
  };
}
