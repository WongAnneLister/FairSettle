import {MigrationInterface, QueryRunner} from 'typeorm';

/** Every table inheriting CoreEntity. */
const CORE_TABLES = [
  'category',
  'dish',
  'email_verification',
  'order',
  'order_item',
  'outbox_event',
  'payment',
  'processed_event',
  'restaurant',
  'user',
];

/** Columns outside CoreEntity that hold an instant. */
const EXTRA_COLUMNS: ReadonlyArray<[string, string]> = [['restaurant', 'promotedUntil']];

/**
 * B15 — every timestamp column stored an instant with no offset.
 *
 * TypeORM's `@CreateDateColumn()` defaults to `timestamp without time zone`.
 * The database runs in UTC; an application process generally does not.
 * node-postgres parses an offset-less timestamp as LOCAL time, so on a UTC+8
 * host every row read back eight hours earlier than it was written.
 *
 * Comparisons inside the database were unaffected — both sides were the same
 * type — so nothing ever errored. Only the values the application saw were
 * wrong, which is why it survived.
 *
 * Hand-written. This is the fourth generated migration in this project that
 * would have damaged data, and by far the most destructive: for a type change
 * TypeORM emits
 *
 *   ALTER TABLE "dish" DROP COLUMN "createdAt";
 *   ALTER TABLE "dish" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();
 *
 * which does not convert anything — it discards the column and creates a new one
 * defaulted to now(). Every createdAt and updatedAt in the database becomes the
 * moment the deploy ran. Confirmed by running it: a dish created at 14:07:07
 * came back as 16:17:41, the migration's own clock.
 *
 * `ALTER COLUMN ... TYPE ... USING` converts in place instead. The USING clause
 * is explicit about the assumption being made — the stored values were written
 * by the database's own now() while it runs in UTC, so that is how they are
 * reinterpreted. Leaving it implicit would silently use the session timezone,
 * which is only correct by accident.
 */
export class TimestampsWithTimeZone1789748247051 implements MigrationInterface {
  name = 'TimestampsWithTimeZone1789748247051';

  private columns(): ReadonlyArray<[string, string]> {
    return [
      ...CORE_TABLES.flatMap(
        table =>
          [
            [table, 'createdAt'],
            [table, 'updatedAt'],
          ] as Array<[string, string]>,
      ),
      ...EXTRA_COLUMNS,
    ];
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz ` +
          `USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp ` +
          `USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }
}
