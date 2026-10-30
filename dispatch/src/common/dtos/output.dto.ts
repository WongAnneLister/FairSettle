import {Field, ObjectType} from '@nestjs/graphql';

@ObjectType()
export class CoreOutput {
  @Field(type => String, {nullable: true})
  error?: string;

  @Field(type => Boolean)
  ok: boolean;

  /**
   * Stable failure code — NOT_FOUND, FORBIDDEN, CONFLICT, VALIDATION, UNAVAILABLE, INTERNAL.
   * `error` is prose for a human; this is what a client should branch on.
   * Null on success.
   */
  @Field(type => String, {nullable: true})
  code?: string;
}
