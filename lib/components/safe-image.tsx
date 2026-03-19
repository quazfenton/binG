/**
 * SafeImage Component
 * 
 * A wrapper around Next.js Image component that validates URLs
 * and provides fallback handling for blocked images.
 * 
 * Usage:
 * ```tsx
 * <SafeImage
 *   src="https://example.com/image.jpg"
 *   alt="Example"
 *   width={400}
 *   height={300}
 *   fallbackSrc="/placeholder.png"
 * />
 * ```
 */

'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect } from 'react';
import { validateImageUrl } from '@/lib/utils/image-loader';

interface SafeImageProps extends Omit<ImageProps, 'src' | 'onError'> {
  src: string;
  /** Fallback image URL if validation fails or image errors */
  fallbackSrc?: string;
  /** Enable strict validation (default: true) */
  strict?: boolean;
  /** Callback when image is blocked */
  onBlocked?: (url: string, reason: string) => void;
}

/**
 * Default placeholder SVG (gray rectangle)
 */
const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2U1ZTdlYiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzljYTNhZiIgZm9udC1zaXplPSIxNiI+SW1hZ2U8L3RleHQ+PC9zdmc+';

export function SafeImage({
  src,
  fallbackSrc = DEFAULT_PLACEHOLDER,
  strict = true,
  onBlocked,
  alt,
  ...props
}: SafeImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(fallbackSrc);
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    // Skip validation for relative paths
    if (src.startsWith('/') || src.startsWith('./')) {
      setImageSrc(src);
      setIsValidating(false);
      return;
    }

    // Validate the URL
    const validation = validateImageUrl(src);
    
    if (!validation.valid) {
      console.warn(`[SafeImage] Blocked unsafe image: ${src} - ${validation.error}`);
      onBlocked?.(src, validation.error || 'Unknown error');
      setImageSrc(fallbackSrc);
    } else {
      setImageSrc(src);
    }
    
    setIsValidating(false);
  }, [src, fallbackSrc, onBlocked]);

  const handleError = () => {
    // If the current src is not the fallback, switch to fallback
    if (imageSrc !== fallbackSrc && imageSrc !== src) {
      setImageSrc(fallbackSrc);
    }
  };

  if (isValidating) {
    // Show placeholder while validating
    return (
      <Image
        src={fallbackSrc}
        alt={alt || 'Loading...'}
        {...props}
      />
    );
  }

  return (
    <Image
      src={imageSrc}
      alt={alt}
      onError={handleError}
      {...props}
    />
  );
}

/**
 * Pre-validate an image URL before using it
 * 
 * @param url - Image URL to validate
 * @returns Validation result
 */
export function useImageValidation(url: string) {
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setIsValid(false);
      setError('No URL provided');
      return;
    }

    const validation = validateImageUrl(url);
    setIsValid(validation.valid);
    setError(validation.error || null);
  }, [url]);

  return { isValid, error };
}

export default SafeImage;
