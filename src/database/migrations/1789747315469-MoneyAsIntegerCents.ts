import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * B12 — money had no way to represent $12.50.
 *
 * `Dish.price` was a bare `@Column()` over a TS `number`, which TypeORM infers
 * as `integer`, while `Order.total` was exposed as a GraphQL `Float` over the
 * same integer representation. The API therefore promised decimals the storage
 * could not hold, and 12.50 was stored as 12.
 *
 * Switched to integer cents, with the unit in the column name. A money column
 * called `price` tells a reader nothing about whether 1250 is twelve dollars or
 * twelve hundred.
 *
 * Hand-edited, for the third time in this project. `migration:generate`
 * produced only the two renames:
 *
 *   ALTER TABLE "dish"  RENAME COLUMN "price" TO "priceCents";
 *   ALTER TABLE "order" RENAME COLUMN "total" TO "totalCents";
 *
 * Correct as far as it goes, and useless on its own: every existing row holds a
 * whole-dollar figure that now claims to be cents, so the entire price list
 * silently drops by a factor of 100. Renaming a column is a schema change and
 * rescaling its contents is not, so the generator will never produce the second
 * half.
 *
 * The `extra` amounts nested in `dish.options` need the same treatment. They
 * live inside a json column, so they are invisible to the generator entirely —
 * not merely omitted, but undetectable.
 */
export class MoneyAsIntegerCents1789747315469 implements MigrationInterface {
  name = 'MoneyAsIntegerCents1789747315469';

  /**
   * Rewrites the money keys inside dish.options, at both the option level and
   * inside each option's choices.
   */
  private rescaleOptions(from: string, to: string, factor: number): string {
    const rekey = (obj: string) => `
      (${obj} - '${from}')
      || CASE WHEN ${obj} ? '${from}' AND ${obj}->>'${from}' IS NOT NULL
              THEN jsonb_build_object('${to}', ((${obj}->>'${from}')::numeric * ${factor})::int)
              ELSE '{}'::jsonb END`;

    return `
      UPDATE "dish" d
         SET options = (
           SELECT jsonb_agg(
             (${rekey("(opt - 'choices')")})
             || CASE WHEN opt ? 'choices' AND jsonb_typeof(opt->'choices') = 'array'
                     THEN jsonb_build_object('choices', COALESCE((
                            SELECT jsonb_agg(${rekey('ch')})
                              FROM jsonb_array_elements(opt->'choices') ch), '[]'::jsonb))
                     ELSE '{}'::jsonb END
           )::text::json
             FROM jsonb_array_elements(d.options::jsonb) opt
         )
       WHERE d.options IS NOT NULL
         AND jsonb_typeof(d.options::jsonb) = 'array'
         AND jsonb_array_length(d.options::jsonb) > 0`;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dish" RENAME COLUMN "price" TO "priceCents"`);
    await queryRunner.query(`ALTER TABLE "order" RENAME COLUMN "total" TO "totalCents"`);

    // The half the generator does not write. Values stored as whole units
    // become the same amount expressed in cents.
    await queryRunner.query(`UPDATE "dish" SET "priceCents" = "priceCents" * 100`);
    await queryRunner.query(
      `UPDATE "order" SET "totalCents" = "totalCents" * 100 WHERE "totalCents" IS NOT NULL`,
    );
    await queryRunner.query(this.rescaleOptions('extra', 'extraCents', 100));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Lossy by nature: an amount that is not a whole number of dollars cannot
    // survive the trip back. Integer division is the honest behaviour — the old
    // schema had no way to represent the remainder either.
    await queryRunner.query(this.rescaleOptions('extraCents', 'extra', 0.01));
    await queryRunner.query(
      `UPDATE "order" SET "totalCents" = "totalCents" / 100 WHERE "totalCents" IS NOT NULL`,
    );
    await queryRunner.query(`UPDATE "dish" SET "priceCents" = "priceCents" / 100`);

    await queryRunner.query(`ALTER TABLE "order" RENAME COLUMN "totalCents" TO "total"`);
    await queryRunner.query(`ALTER TABLE "dish" RENAME COLUMN "priceCents" TO "price"`);
  }
}
