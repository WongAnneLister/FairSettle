import {MigrationInterface, QueryRunner} from 'typeorm';

/** A terminal DeliveryFailed status with a failure reason on its order event (F25). */
export class DeliveryFailure1790000003000 implements MigrationInterface {
  name = 'DeliveryFailure1790000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."order_status_enum" ADD VALUE IF NOT EXISTS 'DeliveryFailed'`,
    );
    await queryRunner.query('ALTER TABLE "order_event" ADD "failureReason" character varying(16)');
    await queryRunner.query('ALTER TABLE "order_event" DROP CONSTRAINT "CHK_order_event_status"');
    await queryRunner.query(`ALTER TABLE "order_event" ADD CONSTRAINT "CHK_order_event_status" CHECK (
      ("fromStatus" IS NULL OR "fromStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered', 'DeliveryFailed'))
      AND ("toStatus" IS NULL OR "toStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered', 'DeliveryFailed')))`);
    await queryRunner.query(`ALTER TABLE "order_event" ADD CONSTRAINT "CHK_order_event_failure" CHECK (
      ("failureReason" IS NULL OR "failureReason" IN ('DRIVER_FAULT', 'PLATFORM_FAULT'))
      AND (("kind" = 'STATUS_CHANGED' AND "toStatus" = 'DeliveryFailed') = ("failureReason" IS NOT NULL)))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_event_delivery_failed" ON "order_event" ("id") WHERE "toStatus" = 'DeliveryFailed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [row] = await queryRunner.query(
      `SELECT count(*) FROM "order" WHERE "status" = 'DeliveryFailed'`,
    );
    if (Number(row.count) !== 0)
      throw new Error('Cannot remove DeliveryFailed while orders use it');
    await queryRunner.query('DROP INDEX "public"."IDX_order_event_delivery_failed"');
    await queryRunner.query('ALTER TABLE "order_event" DROP CONSTRAINT "CHK_order_event_failure"');
    await queryRunner.query('ALTER TABLE "order_event" DROP CONSTRAINT "CHK_order_event_status"');
    await queryRunner.query(`ALTER TABLE "order_event" ADD CONSTRAINT "CHK_order_event_status" CHECK (
      ("fromStatus" IS NULL OR "fromStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered'))
      AND ("toStatus" IS NULL OR "toStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered')))`);
    await queryRunner.query('ALTER TABLE "order_event" DROP COLUMN "failureReason"');
    await queryRunner.query(
      'ALTER TYPE "public"."order_status_enum" RENAME TO "order_status_enum_old"',
    );
    await queryRunner.query(
      `CREATE TYPE "public"."order_status_enum" AS ENUM('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered')`,
    );
    await queryRunner.query('ALTER TABLE "order" ALTER COLUMN "status" DROP DEFAULT');
    await queryRunner.query(
      'ALTER TABLE "order" ALTER COLUMN "status" TYPE "public"."order_status_enum" USING "status"::text::"public"."order_status_enum"',
    );
    await queryRunner.query(`ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'Pending'`);
    await queryRunner.query('DROP TYPE "public"."order_status_enum_old"');
  }
}
