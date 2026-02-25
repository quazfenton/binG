type StoredUrl = {
  id: string;
  original: string;
  clicks: number;
  created: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __urlShortenerStore: Map<string, StoredUrl> | undefined;
}

const store = globalThis.__urlShortenerStore ?? new Map<string, StoredUrl>();
if (!globalThis.__urlShortenerStore) {
  globalThis.__urlShortenerStore = store;
}

export const urlShortenerStore = store;
export type { StoredUrl };
