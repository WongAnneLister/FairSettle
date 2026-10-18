import {Field, ObjectType} from '@nestjs/graphql';
import {CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn} from 'typeorm';

@ObjectType()
export class CoreEntity {
  @Field(type => Number)
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * `timestamptz`, not TypeORM's default `timestamp`.
   *
   * A `timestamp without time zone` stores no offset, so node-postgres parses
   * whatever comes back as LOCAL time while the database runs in UTC. On a UTC+8
   * host every row read back was eight hours in the past. Comparisons inside the
   * database were unaffected — both sides are the same type — so nothing errored
   * and only the values the application saw were wrong.
   */
  @Field(type => Date)
  @CreateDateColumn({type: 'timestamptz'})
  createdAt: Date;

  @Field(type => Date)
  @UpdateDateColumn({type: 'timestamptz'})
  updatedAt: Date;
}
