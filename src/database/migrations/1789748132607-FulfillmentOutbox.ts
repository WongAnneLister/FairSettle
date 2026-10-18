import { MigrationInterface, QueryRunner } from "typeorm";

export class FulfillmentOutbox1789748132607 implements MigrationInterface {
    name = 'FulfillmentOutbox1789748132607'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "outbox_event" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "type" character varying(64) NOT NULL, "aggregateId" integer NOT NULL, "payload" json NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'Pending', "attempts" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastError" text, "providerRef" character varying(128), CONSTRAINT "PK_cc0c9e40998e45ecfc5e313429d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cb8a816fe56462e1574aaa6ec1" ON "outbox_event" ("providerRef") `);
        await queryRunner.query(`CREATE INDEX "IDX_fea4c032d2ae2f98aaea51fec0" ON "outbox_event" ("status", "nextAttemptAt") `);
        await queryRunner.query(`CREATE TABLE "processed_event" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "eventId" character varying(128) NOT NULL, "type" character varying(64) NOT NULL, CONSTRAINT "PK_1d63356c8b4bb356575f85b629d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_276e1594ffc073ea1605951715" ON "processed_event" ("eventId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_276e1594ffc073ea1605951715"`);
        await queryRunner.query(`DROP TABLE "processed_event"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fea4c032d2ae2f98aaea51fec0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb8a816fe56462e1574aaa6ec1"`);
        await queryRunner.query(`DROP TABLE "outbox_event"`);
    }

}
