/**
 * Ethical Ads Service
 *
 * Fetches developer-focused, privacy-respecting ads from EthicalAds API.
 * Designed for terminal REPLs and web UIs — returns lightweight JSON
 * with text-only ads that blend into the existing aesthetic.
 *
 * @see https://www.ethicalads.io/
 */

export interface EthicalAdResponse {
  identifier: string;
  image: string;
  url: string;
  text: string;
  legal: string;
  pixel: string;
  view_url: string;
  nonce: string;
}

const API_URL = 'https://server.ethicalads.io/api/v1/ads/';
const DEFAULT_PUBLISHER = process.env.NEXT_PUBLIC_ETHICALADS_PUBLISHER || '';
const ADS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ADS === 'true';
const CACHE_TTL_MS = 60_000; // Rotate every 60 seconds

let cachedAd: EthicalAdResponse | null = null;
let cachedAt = 0;

/**
 * Fetch a rotating developer ad.
 * Falls back to a built-in sponsor message when the API is unavailable.
 */
export async function fetchEthicalAd(keywords: string[] = ['ai', 'typescript', 'developer']): Promise<EthicalAdResponse | null> {
  // Return cached ad if still fresh
  if (cachedAd && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedAd;
  }

  try {
    const params = new URLSearchParams({
      publisher: DEFAULT_PUBLISHER || 'bing-ai',
      format: 'json',
      ad_types: 'text-only',
      keywords: keywords.join('|'),
    });

    const response = await fetch(`${API_URL}?${params}`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      throw new Error(`EthicalAds API returned ${response.status}`);
    }

    const data = await response.json();
    const ad: EthicalAdResponse = data.results?.[0] ?? data;

    if (!ad?.text) {
      return null;
    }

    // Fire impression pixel (best-effort, don't block)
    if (ad.pixel) {
      fetch(ad.pixel, { mode: 'no-cors', signal: AbortSignal.timeout(2000) }).catch(() => {});
    }

    cachedAd = ad;
    cachedAt = Date.now();
    return ad;
  } catch (err) {
    // Silently fall back to built-in sponsor
    return null;
  }
}

/**
 * Built-in fallback sponsor messages shown when the API is unreachable.
 */
export const FALLBACK_ADS: EthicalAdResponse[] = [
  {
    identifier: 'fallback-1',
    image: '',
    url: 'https://ethicalads.io',
    text: 'EthicalAds — developer-focused ads that respect your privacy.',
    legal: 'Ads by EthicalAds',
    pixel: '',
    view_url: '',
    nonce: '',
  },
  {
    identifier: 'fallback-2',
    image: '',
    url: 'https://ethicalads.io',
    text: 'Support this project — disable your adblocker for ethicalads.io.',
    legal: 'Ads by EthicalAds',
    pixel: '',
    view_url: '',
    nonce: '',
  },
];

let fallbackIndex = 0;

/**
 * Whether sponsor ads are enabled via environment variable.
 */
export function adsEnabled(): boolean {
  return ADS_ENABLED;
}

/**
 * Get an ad response — returns null when ads are disabled.
 * Tries the API first, falls back to built-in sponsors when enabled.
 */
export async function getSponsorAd(keywords?: string[]): Promise<EthicalAdResponse | null> {
  if (!ADS_ENABLED) return null;
  const ad = await fetchEthicalAd(keywords);
  if (ad) return ad;

  // Rotate through fallback ads
  const fallback = FALLBACK_ADS[fallbackIndex % FALLBACK_ADS.length];
  fallbackIndex++;
  return fallback;
}

/**
 * Track a view/click on the ad (for EthicalAds compliance).
 */
export function trackAdView(ad: EthicalAdResponse): void {
  if (ad.view_url) {
    fetch(ad.view_url, { mode: 'no-cors', signal: AbortSignal.timeout(2000) }).catch(() => {});
  }
}
