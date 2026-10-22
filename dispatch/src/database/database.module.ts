import {ConfigService} from '@nestjs/config';
import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';

import {entities} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const isProduction = config.get('NODE_ENV') === 'production';
        return {
          type: 'postgres',
          host: config.get('DB_HOST'),
          port: config.get('DB_PORT'),
          username: config.get('DB_USER'),
          password: config.get('DB_PASSWORD'),
          database: config.get('DB_NAME'),
          entities,
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          // Never infer schema changes from the entities at runtime. Under
          // `synchronize` a renamed field is applied as DROP COLUMN, and the
          // schema has no version an operator can inspect or roll back.
          synchronize: false,
          // Applied automatically outside production so dev and e2e runs always
          // match the migration files. In production migrations are a separate,
          // explicit deploy step (`npm run migration:run`).
          migrationsRun: !isProduction,
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
