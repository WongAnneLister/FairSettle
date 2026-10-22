import {MigrationInterface, QueryRunner} from 'typeorm';

export class OrderQueryIndexes1789745991150 implements MigrationInterface {
  name = 'OrderQueryIndexes1789745991150';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_002bbbfa706d8fe9ace86ac57d" ON "order" ("customerId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ecd8b7ac1fa19cd846b50bab00" ON "order" ("driverId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13fd51216f951358a69f5cd510" ON "order" ("restaurantId", "status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_13fd51216f951358a69f5cd510"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ecd8b7ac1fa19cd846b50bab00"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_002bbbfa706d8fe9ace86ac57d"`);
  }
}
