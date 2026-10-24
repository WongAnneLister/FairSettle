import {MigrationInterface, QueryRunner} from 'typeorm';

/** Add payment state and the receipt inbox without rewriting existing fulfillment state. */
export class LedgerPaymentNotifications1790000001000 implements MigrationInterface {
  name = 'LedgerPaymentNotifications1790000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE \"public\".\"order_paymentstatus_enum\" AS ENUM('NotRequired', 'AwaitingPayment', 'Paid', 'Failed')",
    );
    await queryRunner.query(
      'ALTER TABLE "order" ADD "paymentStatus" "public"."order_paymentstatus_enum" NOT NULL DEFAULT \'NotRequired\'',
    );
    await queryRunner.query(
      'CREATE TABLE "ledger_notification" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "eventId" character varying(64) NOT NULL, "eventType" character varying(64) NOT NULL, "businessKey" character varying(256) NOT NULL, "digest" character(64) NOT NULL, "orderId" integer, "outcome" character varying(128) NOT NULL, CONSTRAINT "PK_31a3526a108a6540532825ff99e" PRIMARY KEY ("id"))',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_ledger_notification_event" ON "ledger_notification" ("eventId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "public"."IDX_ledger_notification_event"');
    await queryRunner.query('DROP TABLE "ledger_notification"');
    await queryRunner.query('ALTER TABLE "order" DROP COLUMN "paymentStatus"');
    await queryRunner.query('DROP TYPE "public"."order_paymentstatus_enum"');
  }
}
