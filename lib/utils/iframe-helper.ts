/**
 * Iframe Helper - URL Transformer
 * Converts standard URLs to embed-friendly versions for iframe display
 */

export type EmbedProvider = 
  | 'youtube'
  | 'vimeo'
  | 'tiktok'
  | 'spotify'
  | 'twitch'
  | 'twitter'
  | 'x'
  | 'reddit'
  | 'giphy'
  | 'soundcloud'
  | 'wikipedia'
  | 'archive'
  | 'openstreetmap'
  | 'duckduckgo'
  | 'codesandbox'
  | 'stackblitz'
  | 'github'
  | 'unknown';

export interface EmbedInfo {
  provider: EmbedProvider;
  embedUrl: string;
  originalUrl: string;
  title?: string;
  id?: string;
  canOpenInPlugin?: boolean;
  suggestedPluginId?: string;
}

/**
 * Transform a standard URL to an embed-friendly version
 */
export function transformToEmbed(urlStr: string, domain: string = 'localhost'): EmbedInfo {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace('www.', '');
    const pathParts = url.pathname.split('/').filter(Boolean);

    // YouTube
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const videoId = host.includes('youtu.be') 
        ? pathParts[0] 
        : url.searchParams.get('v');
      return {
        provider: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1`,
        originalUrl: urlStr,
        id: videoId || undefined,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Vimeo
    if (host.includes('vimeo.com')) {
      const videoId = pathParts[0];
      return {
        provider: 'vimeo',
        embedUrl: `https://player.vimeo.com/video/${videoId}?autoplay=1`,
        originalUrl: urlStr,
        id: videoId,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // TikTok
    if (host.includes('tiktok.com')) {
      const videoId = pathParts[pathParts.length - 1];
      return {
        provider: 'tiktok',
        embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
        originalUrl: urlStr,
        id: videoId,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Spotify
    if (host.includes('spotify.com')) {
      const embedPath = urlStr.replace('.com/', '.com/embed/');
      return {
        provider: 'spotify',
        embedUrl: embedPath,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Twitch
    if (host.includes('twitch.tv')) {
      const channelName = pathParts[0];
      return {
        provider: 'twitch',
        embedUrl: `https://player.twitch.tv/?channel=${channelName}&parent=${domain}&autoplay=false`,
        originalUrl: urlStr,
        id: channelName,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // X (Twitter)
    if (host.includes('x.com') || host.includes('twitter.com')) {
      const username = pathParts[0];
      const statusId = pathParts[2]; // /user/status/12345

      if (pathParts[1] === 'status' && statusId) {
        // Single tweet
        return {
          provider: host.includes('x.com') ? 'x' : 'twitter',
          embedUrl: `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}?hide_conversation=true&widget_type=tweet&id=${statusId}`,
          originalUrl: urlStr,
          id: statusId,
          canOpenInPlugin: true,
          suggestedPluginId: 'generic-embed',
        };
      }
      // Profile timeline
      return {
        provider: host.includes('x.com') ? 'x' : 'twitter',
        embedUrl: `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`,
        originalUrl: urlStr,
        id: username,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Reddit
    if (host.includes('reddit.com')) {
      if (url.pathname.includes('/comments/')) {
        // Specific post/thread
        return {
          provider: 'reddit',
          embedUrl: urlStr.replace('reddit.com', 'redditmedia.com') + '?ref_source=embed&ref=share&embed=true',
          originalUrl: urlStr,
          canOpenInPlugin: true,
          suggestedPluginId: 'generic-embed',
        };
      }
      // Subreddit
      return {
        provider: 'reddit',
        embedUrl: `https://www.redditmedia.com${url.pathname}?embed=true`,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Giphy
    if (host.includes('giphy.com')) {
      const giphyId = pathParts[pathParts.length - 1].split('-').pop();
      return {
        provider: 'giphy',
        embedUrl: `https://giphy.com/embed/${giphyId}`,
        originalUrl: urlStr,
        id: giphyId,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // SoundCloud
    if (host.includes('soundcloud.com')) {
      return {
        provider: 'soundcloud',
        embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(urlStr)}&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'generic-embed',
      };
    }

    // Wikipedia - suggest dedicated plugin
    if (host.includes('wikipedia.org')) {
      return {
        provider: 'wikipedia',
        embedUrl: urlStr,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'wikipedia-embed',
      };
    }

    // Archive.org - suggest dedicated plugin
    if (host.includes('archive.org')) {
      return {
        provider: 'archive',
        embedUrl: urlStr,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'archive-org-embed',
      };
    }

    // OpenStreetMap - suggest dedicated plugin
    if (host.includes('openstreetmap.org')) {
      return {
        provider: 'openstreetmap',
        embedUrl: urlStr,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'openstreetmap-embed',
      };
    }

    // DuckDuckGo - suggest dedicated plugin
    if (host.includes('duckduckgo.com')) {
      return {
        provider: 'duckduckgo',
        embedUrl: urlStr.includes('/html') ? urlStr : 'https://duckduckgo.com/html',
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'duckduckgo-embed',
      };
    }

    // CodeSandbox - suggest dedicated plugin
    if (host.includes('codesandbox.io')) {
      const embedUrl = urlStr.includes('embed=1') ? urlStr : `${urlStr}${urlStr.includes('?') ? '&' : '?'}embed=1`;
      return {
        provider: 'codesandbox',
        embedUrl,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'codesandbox-embed',
      };
    }

    // StackBlitz - suggest dedicated plugin
    if (host.includes('stackblitz.com')) {
      const embedUrl = urlStr.includes('embed=1') ? urlStr : `${urlStr}${urlStr.includes('?') ? '&' : '?'}embed=1`;
      return {
        provider: 'stackblitz',
        embedUrl,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'stackblitz-embed',
      };
    }

    // GitHub - suggest dedicated plugin
    if (host.includes('github.com')) {
      return {
        provider: 'github',
        embedUrl: urlStr,
        originalUrl: urlStr,
        canOpenInPlugin: true,
        suggestedPluginId: 'github-trending-explorer',
      };
    }

    // Unknown/Fallback - try as-is
    return {
      provider: 'unknown',
      embedUrl: urlStr,
      originalUrl: urlStr,
      canOpenInPlugin: true,
      suggestedPluginId: 'generic-embed',
    };
  } catch (e) {
    console.error('Link transformation failed:', e);
    return {
      provider: 'unknown',
      embedUrl: urlStr,
      originalUrl: urlStr,
      canOpenInPlugin: false,
    };
  }
}

/**
 * Check if a URL is embeddable
 */
export function isEmbeddableUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace('www.', '').toLowerCase();
    
    const embeddableHosts = [
      'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com',
      'spotify.com', 'twitch.tv', 'x.com', 'twitter.com',
      'reddit.com', 'giphy.com', 'soundcloud.com',
      'wikipedia.org', 'archive.org', 'openstreetmap.org',
      'duckduckgo.com', 'codesandbox.io', 'stackblitz.com',
      'github.com'
    ];
    
    return embeddableHosts.some(h => host.includes(h));
  } catch {
    return false;
  }
}

/**
 * Get provider name from URL
 */
export function getProviderFromUrl(urlStr: string): EmbedProvider {
  return transformToEmbed(urlStr).provider;
}

/**
 * Extract video/post ID from URL
 */
export function extractIdFromUrl(urlStr: string): string | undefined {
  return transformToEmbed(urlStr).id;
}

/**
 * Get suggested plugin for a URL
 */
export function getSuggestedPlugin(urlStr: string): string | undefined {
  return transformToEmbed(urlStr).suggestedPluginId;
}

/**
 * Detect embeddable links in text content
 */
export function detectEmbeddableLinks(text: string): Array<{ url: string; provider: EmbedProvider; embedUrl: string }> {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
  const matches = text.match(urlRegex) || [];
  
  return matches
    .map(url => {
      const cleanUrl = url.replace(/[.,;!?)]+$/, ''); // Remove trailing punctuation
      const info = transformToEmbed(cleanUrl);
      return {
        url: cleanUrl,
        provider: info.provider,
        embedUrl: info.embedUrl,
      };
    })
    .filter(item => item.provider !== 'unknown');
}

/**
 * Format URL for display (truncate long URLs)
 */
export function formatUrlForDisplay(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url;
  
  try {
    const urlObj = new URL(url);
    const display = `${urlObj.hostname}${urlObj.pathname}`;

    if (display.length <= maxLength) return display;

    return `${display.substring(0, maxLength - 3)}...`;
  } catch {
    return `${url.substring(0, maxLength - 3)}...`;
  }
}

/**
 * Get secondary fallback URL when primary embed fails
 * Tries alternative embed providers or direct URL
 */
export function getSecondaryFallbackUrl(embedUrl: string): string {
  try {
    const url = new URL(embedUrl);
    const host = url.hostname;

    // YouTube fallback: Try different embed parameters
    if (host.includes('youtube.com')) {
      return embedUrl.replace('?rel=0&autoplay=1', '?rel=0&modestbranding=1');
    }

    // Vimeo fallback: Try privacy-enhanced version
    if (host.includes('vimeo.com')) {
      return embedUrl.replace('player.vimeo.com', 'player.vimeo.com');
    }

    // Generic fallback: Try https if http, or remove www
    if (embedUrl.startsWith('http://')) {
      return embedUrl.replace('http://', 'https://');
    }

    return embedUrl.replace('www.', '');
  } catch {
    return embedUrl;
  }
}
