import * as request from 'supertest';

import {createTestApp, destroyTestApp, TestContext} from './utils/e2e';

describe('Health probe CSRF exemption', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    if (context) {
      await destroyTestApp(context);
    }
  });

  it('probe passes CSRF', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/graphql?query=%7B__typename%7D')
      .expect(200);
    expect(response.body).toEqual({data: {__typename: 'Query'}});
  });

  it('other GET still blocked', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/graphql?query=%7B__typename%20__typename%7D')
      .expect(400);
    expect(response.text).toContain('Cross-Site Request Forgery');
  });

  it('POST still blocked', async () => {
    const response = await request(context.app.getHttpServer())
      .post('/graphql')
      .set('Content-Type', 'text/plain')
      .send('{"query":"{__typename}"}')
      .expect(400);
    expect(response.text).toContain('Cross-Site Request Forgery');
  });
});
