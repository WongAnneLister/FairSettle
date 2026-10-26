import {SetMetadata} from '@nestjs/common';
import {createHash, timingSafeEqual} from 'crypto';

export const SERVICE_TOKEN_HEADER = 'x-service-token';
export const SERVICE_READABLE = 'serviceReadable';
export const ServiceReadable = () => SetMetadata(SERVICE_READABLE, true);

/** Hashes have equal lengths, preventing a length leak or a timingSafeEqual throw. */
export function serviceTokenMatches(configured: string | undefined, given: unknown): boolean {
  if (!configured || typeof given !== 'string' || !given) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(configured), digest(given));
}
