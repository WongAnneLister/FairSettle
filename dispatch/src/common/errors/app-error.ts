/**
 * Stable, machine-readable failure codes.
 *
 * The baseline returned `{ok: false, error: '<sentence>'}` for every failure, so
 * a caller could not distinguish "this order does not exist" from "this order is
 * not yours" from "someone else just claimed it" — the last of which is the only
 * one worth retrying. Prose is for humans; the code is for the client.
 */
export type AppErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'INTERNAL';

/**
 * A failure the service meant to produce. Anything that is NOT an AppError
 * reaching a catch block is a bug, and is logged as one — see `failure()`.
 */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The addressed resource does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

/** The resource exists but this caller may not touch it. */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super('FORBIDDEN', message);
  }
}

/** The request lost a race, or conflicts with the resource's current state. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message);
  }
}

/** The input is not acceptable for this operation. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION', message);
  }
}
