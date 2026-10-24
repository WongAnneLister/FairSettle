import {NextFunction, Request, Response} from 'express';

export const HEALTH_PROBE_QUERY = '{__typename}';
export const PREFLIGHT_HEADER = 'apollo-require-preflight';

/** Lets the compose health probe GET /graphql?query={__typename} past Apollo's CSRF check; nothing else. */
export function healthProbeCsrfExemption(req: Request, _res: Response, next: NextFunction): void {
  if (
    req.method === 'GET' &&
    Object.keys(req.query).length === 1 &&
    req.query.query === HEALTH_PROBE_QUERY &&
    req.headers[PREFLIGHT_HEADER] === undefined
  ) {
    req.headers[PREFLIGHT_HEADER] = 'health-probe';
  }
  next();
}
