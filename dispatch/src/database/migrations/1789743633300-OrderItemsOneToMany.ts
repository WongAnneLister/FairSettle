import {MigrationInterface, QueryRunner} from 'typeorm';

const FK = 'FK_646bf9ece6f45dbe41c203e06e0';
const JOIN_TABLE = 'order_items_order_item';

/**
 * B8 — Order.items was @ManyToMany with a join table. A line item belongs to
 * exactly one order, so the association becomes one-to-many and the join table
 * goes away.
 *
 * Hand-written. `migration:generate` produced only this:
 *
 *   ALTER TABLE "order_item" ADD "orderId" integer;
 *   ALTER TABLE "order_item" ADD CONSTRAINT ... FOREIGN KEY ("orderId") ...;
 *
 * which is worse than the enum case in FixSchemaTypos, because it does not
 * fail. It adds a nullable column, copies nothing into it, and leaves the join
 * table in place — every existing order silently loses its line items, and the
 * only evidence is orders that suddenly cannot say what was ordered.
 *
 * The generator diffs schema against entities. Moving the data is not a schema
 * difference, so it is never going to appear on its own.
 *
 * On rows left with a NULL orderId: those are order items that have no row in
 * the join table, i.e. the orphans created by B4's missing transaction. They
 * are deliberately left in place. Deleting rows is a data-repair decision that
 * belongs in its own reviewed migration, not smuggled into a schema change.
 */
export class OrderItemsOneToMany1789743633300 implements MigrationInterface {
  name = 'OrderItemsOneToMany1789743633300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_item" ADD "orderId" integer`);

    // The step the generator omits. Must happen before the constraint, and
    // before the join table is dropped.
    await queryRunner.query(`
      UPDATE "order_item" oi
         SET "orderId" = j."orderId"
        FROM "${JOIN_TABLE}" j
       WHERE j."orderItemId" = oi.id
    `);

    await queryRunner.query(
      `ALTER TABLE "order_item" ADD CONSTRAINT "${FK}" ` +
        `FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`DROP TABLE "${JOIN_TABLE}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "${JOIN_TABLE}" (` +
        `"orderId" integer NOT NULL, "orderItemId" integer NOT NULL, ` +
        `CONSTRAINT "PK_47e772f9eee1a381c1ac49a5493" PRIMARY KEY ("orderId", "orderItemId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92da8ddb745c9937cb97e74f56" ON "${JOIN_TABLE}" ("orderId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a25840cab46360d68745e42231" ON "${JOIN_TABLE}" ("orderItemId")`,
    );

    // Put the associations back before dropping the column that holds them.
    await queryRunner.query(`
      INSERT INTO "${JOIN_TABLE}" ("orderId", "orderItemId")
      SELECT "orderId", id FROM "order_item" WHERE "orderId" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "${JOIN_TABLE}" ADD CONSTRAINT "FK_92da8ddb745c9937cb97e74f56c" ` +
        `FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "${JOIN_TABLE}" ADD CONSTRAINT "FK_a25840cab46360d68745e42231d" ` +
        `FOREIGN KEY ("orderItemId") REFERENCES "order_item"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    await queryRunner.query(`ALTER TABLE "order_item" DROP CONSTRAINT "${FK}"`);
    await queryRunner.query(`ALTER TABLE "order_item" DROP COLUMN "orderId"`);
  }
}
