'use client';
import { useServiceWorker } from '@/hooks/use-service-worker';

export function ServiceWorkerManager() {
  useServiceWorker(); // This registers the SW
  return null; // Renders nothing
}
