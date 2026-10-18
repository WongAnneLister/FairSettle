import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Fixes two misspellings that were part of the public GraphQL schema:
 * `updateAt` -> `updatedAt` (B11) and the `Coocking` enum value (B10).
 *
 * The enum half of this migration is hand-written. TypeORM generated the
 * conventional swap-the-type dance:
 *
 *   ALTER TYPE order_status_enum RENAME TO order_status_enum_old
 *   CREATE TYPE order_status_enum AS ENUM('Pending', 'Cooking', ...)
 *   ALTER TABLE "order" ALTER COLUMN status
 *     TYPE order_status_enum USING status::text::order_status_enum
 *   DROP TYPE order_status_enum_old
 *
 * That cast cannot succeed for a row already holding 'Coocking', because the
 * value does not exist in the new type. Verified against a database with one
 * such order:
 *
 *   error: invalid input value for enum order_status_enum: "Coocking"
 *
 * The migration aborts and rolls back — so it would have passed on an empty CI
 * database and failed on the first production deploy, which is the worst
 * possible place to discover it.
 *
 * PostgreSQL 10+ can rename an enum member in place. One statement, no cast, no
 * rewrite, and every existing row keeps its value.
 *
 * The column renames below are TypeORM's own output and are already correct:
 * it emitted RENAME COLUMN rather than DROP + ADD, so no data is lost.
 */
export class FixSchemaTypos1789741740482 implements MigrationInterface {
  name = 'FixSchemaTypos1789741740482';

  private static readonly TABLES = [
    'dish',
    'order_item',
    'payment',
    'user',
    'order',
    'restaurant',
    'category',
    'email_verification',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of FixSchemaTypos1789741740482.TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "updateAt" TO "updatedAt"`);
    }
    await queryRunner.query(
      `ALTER TYPE "public"."order_status_enum" RENAME VALUE 'Coocking' TO 'Cooking'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."order_status_enum" RENAME VALUE 'Cooking' TO 'Coocking'`,
    );
    for (const table of [...FixSchemaTypos1789741740482.TABLES].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "updatedAt" TO "updateAt"`);
    }
  }
}
