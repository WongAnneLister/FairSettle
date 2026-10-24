import {NextFunction, Request, Response} from 'express';

import {healthProbeCsrfExemption, PREFLIGHT_HEADER} from './health-probe.middleware';

describe('healthProbeCsrfExemption', () => {
  function invoke(method: string, query: unknown, headers: Record<string, string> = {}) {
    const next = jest.fn();
    const req = {method, query, headers} as unknown as Request;
    healthProbeCsrfExemption(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    return headers;
  }

  it('exempts the exact probe', () => {
    expect(invoke('GET', {query: '{__typename}'})).toEqual({
      [PREFLIGHT_HEADER]: 'health-probe',
    });
  });

  it('ignores other queries', () => {
    expect(invoke('GET', {query: '{me{id}}'})).toEqual({});
  });

  it('is whitespace-exact', () => {
    expect(invoke('GET', {query: '{ __typename }'})).toEqual({});
  });

  it('rejects extra parameters', () => {
    for (const key of ['operationName', 'variables', 'extensions']) {
      expect(invoke('GET', {query: '{__typename}', [key]: 'x'})).toEqual({});
    }
  });

  it('rejects repeated query', () => {
    expect(invoke('GET', {query: ['{__typename}', '{__typename}']})).toEqual({});
  });

  it('ignores non-GET', () => {
    expect(invoke('POST', {query: '{__typename}'})).toEqual({});
  });

  it('keeps an existing header', () => {
    expect(invoke('GET', {query: '{__typename}'}, {[PREFLIGHT_HEADER]: 'client'})).toEqual({
      [PREFLIGHT_HEADER]: 'client',
    });
  });
});
