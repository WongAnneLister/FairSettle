import * as request from 'supertest';

import {INestApplication} from '@nestjs/common';
import {Test, TestingModule} from '@nestjs/testing';
import {DataSource} from 'typeorm';

import {AppModule} from '../../src/app.module';
import {MailService} from 'src/mail/mail.service';

export const GRAPHQL_ENDPOINT = '/graphql';

export interface TestContext {
  app: INestApplication;
  moduleRef: TestingModule;
  dataSource: DataSource;
}

/**
 * Boots the real application against the test database.
 *
 * MailService is the one provider replaced: account creation awaits an SMTP
 * send, so without an override every e2e run blocks on a network timeout.
 * Everything else — the GraphQL layer, the auth guard, TypeORM, the migrations
 * — runs for real, which is the point of these tests.
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({imports: [AppModule]})
    .overrideProvider(MailService)
    .useValue({sendUserConfirmation: jest.fn().mockResolvedValue(undefined)})
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  // Bind once on an ephemeral port. Without this, supertest calls listen(0) per
  // request; firing twenty in parallel then spins up twenty servers, which both
  // serialises the requests and produces ECONNRESET. The concurrency spec needs
  // the requests to genuinely overlap.
  await app.listen(0);

  return {app, moduleRef, dataSource: app.get(DataSource)};
}

/**
 * Drops every table and closes the connection.
 *
 * TypeORM 0.3 removed the global getConnection(); the DataSource is resolved
 * from the application container instead.
 */
export async function destroyTestApp({app, dataSource}: TestContext): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.dropDatabase();
  }
  await app.close();
}

/**
 * Records the SQL issued while `fn` runs.
 *
 * Swaps the DataSource's logger for the duration, so an N+1 can be asserted as a
 * number rather than described in a comment. Restores the original afterwards,
 * including if `fn` throws.
 */
export async function captureQueries(
  dataSource: DataSource,
  fn: () => Promise<void>,
): Promise<string[]> {
  const queries: string[] = [];
  const original = dataSource.logger;

  dataSource.logger = {
    logQuery: (query: string) => queries.push(query),
    logQueryError: () => undefined,
    logQuerySlow: () => undefined,
    logSchemaBuild: () => undefined,
    logMigration: () => undefined,
    log: () => undefined,
  };

  try {
    await fn();
  } finally {
    dataSource.logger = original;
  }

  return queries;
}

/** POST a GraphQL document, optionally authenticated. */
export function gql(app: INestApplication, query: string, token?: string) {
  const req = request(app.getHttpServer()).post(GRAPHQL_ENDPOINT);
  // The server reads the token from the `Authorization` header — see TOKEN_KEY
  // in app.module.ts. It is sent raw, with no `Bearer ` prefix.
  if (token) {
    req.set('Authorization', token);
  }
  return req.send({query});
}

/** Registers an account and returns its login token. */
export async function registerAndLogin(
  app: INestApplication,
  email: string,
  role: 'Client' | 'Owner' | 'Delivery',
  password = 'secret123',
): Promise<string> {
  const created = await gql(
    app,
    `mutation { createAccount(input: {email: "${email}", password: "${password}", role: ${role}}) { ok error } }`,
  );
  expect(created.body.data.createAccount).toEqual({ok: true, error: null});

  const loggedIn = await gql(
    app,
    `mutation { login(input: {email: "${email}", password: "${password}"}) { ok error token } }`,
  );
  expect(loggedIn.body.data.login.ok).toBe(true);

  return loggedIn.body.data.login.token;
}
