import {MigrationInterface, QueryRunner} from 'typeorm';

/** Add an immutable fulfillment timeline without backfilling existing orders (F19). */
export class OrderEventLog1790000002000 implements MigrationInterface {
  name = 'OrderEventLog1790000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "order_event" (
  "id" SERIAL NOT NULL,
  "orderId" integer NOT NULL,
  "kind" character varying(32) NOT NULL,
  "fromStatus" character varying(16),
  "toStatus" character varying(16),
  "actor" character varying(32) NOT NULL,
  "driverId" integer,
  "providerEventId" character varying(128),
  "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "PK_order_event" PRIMARY KEY ("id"),
  CONSTRAINT "FK_order_event_order" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE,
  CONSTRAINT "CHK_order_event_kind" CHECK ("kind" IN ('CREATED', 'STATUS_CHANGED', 'DRIVER_ASSIGNED')),
  CONSTRAINT "CHK_order_event_actor" CHECK ("actor" IN ('Owner', 'Client', 'AssignedDriver', 'FulfillmentProvider')),
  CONSTRAINT "CHK_order_event_status" CHECK (
    ("fromStatus" IS NULL OR "fromStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered'))
    AND ("toStatus" IS NULL OR "toStatus" IN ('Pending', 'Cooking', 'Cooked', 'PickedUp', 'Delivered'))),
  CONSTRAINT "CHK_order_event_shape" CHECK (
    ("kind" = 'CREATED' AND "fromStatus" IS NULL AND "toStatus" = 'Pending' AND "driverId" IS NULL)
    OR ("kind" = 'STATUS_CHANGED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR ("kind" = 'DRIVER_ASSIGNED' AND "fromStatus" IS NULL AND "toStatus" IS NULL AND "driverId" IS NOT NULL))
);
CREATE INDEX "IDX_order_event_order" ON "order_event" ("orderId", "id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "public"."IDX_order_event_order"');
    await queryRunner.query('DROP TABLE "order_event"');
  }
}
