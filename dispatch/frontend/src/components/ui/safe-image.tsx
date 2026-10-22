'use client';

import React, { useState, useEffect } from 'react';
import Image, { ImageProps } from 'next/image';
import { getValidImageUrl, DEFAULT_RESTAURANT_COVER } from '@/lib/image-helper';

export interface SafeImageProps extends Omit<ImageProps, 'src'> {
  src?: string | null;
  fallback?: string;
}

/**
 * A drop-in replacement for next/image that prevents runtime crashes:
 * 1. Sanitizes bare relative paths like "x.png" or empty strings using getValidImageUrl.
 * 2. Catches broken URLs or 404 image load failures via onError and falls back seamlessly.
 */
export function SafeImage({
  src,
  fallback = DEFAULT_RESTAURANT_COVER,
  alt,
  onError,
  ...props
}: SafeImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string>(() =>
    getValidImageUrl(src, fallback)
  );

  useEffect(() => {
    setCurrentSrc(getValidImageUrl(src, fallback));
  }, [src, fallback]);

  return (
    <Image
      {...props}
      src={currentSrc}
      alt={alt || 'Food delivery image'}
      onError={(e) => {
        if (currentSrc !== fallback) {
          setCurrentSrc(fallback);
        }
        if (onError) {
          onError(e);
        }
      }}
    />
  );
}
