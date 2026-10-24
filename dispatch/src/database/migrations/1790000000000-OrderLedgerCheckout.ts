import {MigrationInterface, QueryRunner} from 'typeorm';

/** Add checkout references without rewriting existing orders or line items. */
export class OrderLedgerCheckout1790000000000 implements MigrationInterface {
  name = 'OrderLedgerCheckout1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "order" ADD "ledgerPaymentId" character varying(64)');
    await queryRunner.query('ALTER TABLE "order" ADD "checkoutUrl" text');
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_order_ledger_payment" ON "order" ("ledgerPaymentId") WHERE "ledgerPaymentId" IS NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "public"."IDX_order_ledger_payment"');
    await queryRunner.query('ALTER TABLE "order" DROP COLUMN "checkoutUrl"');
    await queryRunner.query('ALTER TABLE "order" DROP COLUMN "ledgerPaymentId"');
  }
}
