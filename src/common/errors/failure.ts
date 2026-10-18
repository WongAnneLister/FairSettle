import {Logger} from '@nestjs/common';

import {AppError, AppErrorCode} from './app-error';

export interface FailureOutput {
  ok: false;
  error: string;
  code: AppErrorCode;
}

/**
 * Converts a thrown value into the project's `{ok, error}` envelope, and — the
 * point of this helper — decides whether it deserves a log line.
 *
 * The baseline wrote `catch { return {ok: false, error: 'Could not get orders'} }`
 * in eight places. That flattens an expected outcome ("not your order") and a
 * genuine defect (a TypeError, a dropped connection, a constraint violation)
 * into the same sentence, and leaves nothing behind to diagnose from. Two of the
 * bugs in this audit hid there for the project's entire history: B1 threw a
 * TypeError on every call, and B13 threw one for the most ordinary order the
 * system can receive. Both surfaced to the client as a generic sentence.
 *
 * So the two cases are separated deliberately:
 *   - AppError      — intended, caller-visible. Logged at debug.
 *   - anything else — a bug. Logged at error with its stack and the operation
 *                     context, and reported generically so internals do not leak.
 */
export function failure(
  error: unknown,
  logger: Logger,
  context: Record<string, unknown>,
): FailureOutput {
  const where = JSON.stringify(context);

  if (error instanceof AppError) {
    logger.debug(`${error.code} ${error.message} ${where}`);
    return {ok: false, error: error.message, code: error.code};
  }

  logger.error(
    `Unhandled failure ${where}`,
    error instanceof Error ? error.stack : String(error),
  );
  return {ok: false, error: 'Something went wrong.', code: 'INTERNAL'};
}
