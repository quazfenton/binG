'use client';

// Minimal error page - returns null to avoid any prerender context issues
export default function Error({
  error,
}: {
  error: Error & { digest?: string } | null;
}) {
  return null;
}