import {AuthModule} from './auth/auth.module';
import {CommonModule} from './common/common.module';
import {ConfigModule} from '@nestjs/config';
import {DatabaseModule} from './database/database.module';
import {GraphQLModule} from '@nestjs/graphql';
import {JwtModule} from './jwt/jwt.module';
import {MailModule} from './mail/mail.module';
import {Module} from '@nestjs/common';
import {FulfillmentModule} from './fulfillment/fulfillment.module';
import {OrdersModule} from './orders/orders.module';
import {PaymentsModule} from './payments/payments.module';
import {RestaurantsModule} from './restaurants/restaurants.module';
import {ScheduleModule} from '@nestjs/schedule';
import {UsersModule} from './users/users.module';
import {environments} from './config/environments';
import {schema} from './config/schema-validation';
import {UploadsModule} from './uploads/uploads.module';
import {ApolloDriver, ApolloDriverConfig} from '@nestjs/apollo';

const TOKEN_KEY = 'Authorization';

/** Per-connection scratch space graphql-ws threads from onConnect to context. */
type GqlWsExtra = {token?: string};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: environments[process.env.NODE_ENV] || '.env.dev',
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validationSchema: schema,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      subscriptions: {
        // subscriptions-transport-ws was unmaintained and is unsupported by
        // Apollo Server 4+. graphql-ws hands the connection payload to
        // onConnect once, so the token is stashed on `extra` for the context
        // factory below to read on every subsequent operation.
        'graphql-ws': {
          onConnect: (context: {connectionParams?: Record<string, unknown>; extra: GqlWsExtra}) => {
            const {connectionParams, extra} = context;
            extra.token = connectionParams?.[TOKEN_KEY] as string | undefined;
          },
        },
      },
      context: (ctx: {req?: {headers: Record<string, string>}; extra?: GqlWsExtra}) => {
        // HTTP operations carry the token on the request header;
        // WebSocket operations carry it on `extra`, set by onConnect above.
        if (ctx.req) {
          return {token: ctx.req.headers[TOKEN_KEY.toLowerCase()]};
        }
        return {token: ctx.extra?.token};
      },
    }),
    JwtModule.forRoot({secretKey: process.env.SECRET_KEY}),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    MailModule,
    CommonModule,
    UsersModule,
    RestaurantsModule,
    OrdersModule,
    FulfillmentModule,
    PaymentsModule,
    UploadsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
