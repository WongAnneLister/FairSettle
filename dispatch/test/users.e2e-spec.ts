import * as request from 'supertest';

import {Repository} from 'typeorm';

import {INestApplication} from '@nestjs/common';
import {User} from 'src/users/entities/user.entity';
import {getRepositoryToken} from '@nestjs/typeorm';
import {EmailVerification} from 'src/users/entities/email-verification.entity';

import {GRAPHQL_ENDPOINT, TestContext, createTestApp, destroyTestApp} from './utils/e2e';

const testUser = {
  email: 'user@mail.com',
  password: '12345',
};

describe('UserModule (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let usersRepository: Repository<User>;
  let emailVerificationRepository: Repository<EmailVerification>;
  let token: string;

  const baseTest = () => request(app.getHttpServer()).post(GRAPHQL_ENDPOINT);
  const publicTest = (query: string) => baseTest().send({query: query});
  // The header was `X-JWT`, which the server never reads: JwtMiddleware looked
  // for it but was never mounted (B5), while the GraphQL context reads
  // `Authorization`. Every authenticated case in this file was therefore
  // running anonymously.
  const privateTest = (query: string) =>
    baseTest().set('Authorization', token).send({query: query});

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    usersRepository = ctx.moduleRef.get<Repository<User>>(getRepositoryToken(User));
    emailVerificationRepository = ctx.moduleRef.get<Repository<EmailVerification>>(
      getRepositoryToken(EmailVerification),
    );
  });

  afterAll(async () => {
    // getConnection() was removed in TypeORM 0.3; the DataSource now comes from
    // the application container.
    await destroyTestApp(ctx);
  });

  describe('createAccount', () => {
    it('should create account', () => {
      return publicTest(`
        mutation {
          createAccount(input: { 
            email: "${testUser.email}",
            password: "${testUser.password}",
            role: Owner
          }) {
            ok
            error
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error} = res.body.data.createAccount;
          expect(ok).toBeTruthy();
          expect(error).toBeNull();
        });
    });

    it('should fail if account already exists', () => {
      return publicTest(`
        mutation {
          createAccount(input: { 
            email: "${testUser.email}",
            password: "${testUser.password}",
            role: Owner
          }) {
            ok
            error
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error} = res.body.data.createAccount;
          expect(ok).toBeFalsy();
          expect(error).toBe('There is a user with that email already.');
        });
    });
  });

  describe('login', () => {
    it('should login with correct credentials', () => {
      return publicTest(`
        mutation {
          login(input: { 
            email: "${testUser.email}",
            password: "${testUser.password}",
          }) {
            ok
            error
            token
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error, token: jwtToken} = res.body.data.login;
          expect(ok).toBeTruthy();
          expect(error).toBeNull();
          expect(jwtToken).toEqual(expect.any(String));
          token = jwtToken;
        });
    });

    it('should not be able to login with wrong credentials', () => {
      return publicTest(`
        mutation {
          login(input: { 
            email: "${testUser.email}",
            password: "321312312313",
          }) {
            ok
            error
            token
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error, token} = res.body.data.login;
          expect(ok).toBeFalsy();
          expect(error).toEqual('The email or password is incorrect.');
          expect(token).toBeNull();
        });
    });
  });

  describe('profile', () => {
    let userEmail: string;
    beforeEach(async () => {
      const [user] = await usersRepository.find();
      userEmail = user.email;
    });

    it("should see a user's", () => {
      return privateTest(`
        query {
          userProfile(email: "user@mail.com") {
            ok
            error
            user {
              email
            }
          }
        }
        `)
        .expect(200)
        .expect(res => {
          const {ok, error, user} = res.body.data.userProfile;
          expect(ok).toBeTruthy();
          expect(error).toBeNull();
          expect(user.email).toBe(userEmail);
        });
    });

    it('should not find a profile', () => {
      return privateTest(`
        query {
          userProfile(email: "test@mail.com") {
            ok
            error
            user {
              email
            }
          }
        }`)
        .expect(200)
        .expect(res => {
          const {ok, error, user} = res.body.data.userProfile;
          expect(ok).toBeFalsy();
          expect(error).toBe('User Not Found');
          expect(user).toBeNull();
        });
    });
  });

  describe('editProfile', () => {
    it('should change email', () => {
      return privateTest(`
        mutation {
          editProfile(input: {
            email: "user@gmail.com"
          }) {
            ok
            error
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error} = res.body.data.editProfile;
          expect(ok).toBeTruthy();
          expect(error).toBeNull();
        });
    });
  });

  describe('verifyEmail', () => {
    let verificationCode: string;
    beforeAll(async () => {
      const [verification] = await emailVerificationRepository.find();
      verificationCode = verification.code;
    });
    it('should verify email', () => {
      return publicTest(`
        mutation {
          verifyEmail(input: {
            code: "${verificationCode}"
          }) {
            ok
            error
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error} = res.body.data.verifyEmail;
          expect(ok).toBeTruthy();
          expect(error).toBeNull();
        });
    });

    it('should fail on verification code not found', () => {
      return publicTest(`
        mutation {
          verifyEmail(input: {
            code: "WRONG_CODE"
          }) {
            ok
            error
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {ok, error} = res.body.data.verifyEmail;
          expect(ok).toBeFalsy();
          expect(error).toBe('Verification not found.');
        });
    });
  });
});
