// ---------------------------------------------------------------------------
// Zine Engine — Pure logic for the avant-garde display system
// Types, templates, notification engine, data sources, auto-styler, utilities
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FragmentType =
  | 'text'
  | 'heading'
  | 'quote'
  | 'data'
  | 'announcement'
  | 'whisper'
  | 'notification'
  | 'media'
  | 'ticker';

export type FragmentSource =
  | 'manual'
  | 'rss'
  | 'webhook'
  | 'json'
  | 'url'
  | 'cron'
  | 'paste'
  | 'api'
  | 'local';

export type ZineAnimation =
  | 'none'
  | 'float'
  | 'fade-in'
  | 'slide-left'
  | 'slide-right'
  | 'drop'
  | 'drift'
  | 'pulse'
  | 'typewriter'
  | 'spiral'
  | 'glitch'
  | 'dissolve';

export type ZoneType =
  | 'hero'
  | 'title'
  | 'body'
  | 'sidebar'
  | 'footer'
  | 'floating'
  | 'ticker'
  | 'full';

export type DisplayMode = 'bounded' | 'unbounded' | 'hybrid';

export type TemplateCategory = 'editorial' | 'experimental' | 'data' | 'notification';

export type ContentUpdateMode = 'append' | 'replace' | 'flash';

export type InputFormat = 'text' | 'json' | 'url' | 'rss';

export interface FragmentStyle {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  opacity: number;
  zIndex: number;
  textAlign: 'left' | 'center' | 'right';
  fontWeight: number;
  letterSpacing: number;
  lineHeight: number;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  mixBlendMode: string;
}

export interface AnimationSeeds {
  floatDuration: number;
  dropInitialRotate: number;
  dropFinalRotate: number;
  driftX1: number;
  driftX2: number;
  driftDuration: number;
  pulseDuration: number;
  dataRainDuration: number;
  messageDriftDuration: number;
}

export interface ZineFragment {
  id: string;
  content: string;
  type: FragmentType;
  source: FragmentSource;
  style: FragmentStyle;
  animation: ZineAnimation;
  animSeeds: AnimationSeeds;
  zone?: ZoneType;
  createdAt: number;
  expiresAt?: number;
  updateMode?: ContentUpdateMode;
  meta?: Record<string, unknown>;
  url?: string;
  author?: string;
  timestamp?: string;
}

export interface ZoneConfig {
  type: ZoneType;
  gridArea?: string;
  bounds?: { x: number; y: number; w: number; h: number };
  overflow: 'hidden' | 'scroll' | 'visible';
  maxFragments: number;
  bordered: boolean;
  label?: string;
}

export interface ZineTemplate {
  id: string;
  name: string;
  emoji: string;
  category: TemplateCategory;
  zones: ZoneConfig[];
  displayMode: DisplayMode;
  fonts: { heading: string; body: string; accent: string; mono: string };
  palette: { bg: string; text: string; accent: string; muted: string; highlight: string };
  defaultAnimation: ZineAnimation;
  overlayCSS?: string;
  backgroundCSS: string;
  maxVisible: number;
  density: 'sparse' | 'normal' | 'dense';
  gridTemplate?: string;
  gridGap?: string;
}

export interface DataSourceConfig {
  id: string;
  type: FragmentSource;
  name: string;
  enabled: boolean;
  url?: string;
  pollIntervalMs: number;
  rssSource?: string;
  transform?: string;
  lastFetchedAt?: number;
  method?: string;
  headers?: Record<string, string>;
  path?: string;
  endpoint?: string;
  query?: string;
  variables?: Record<string, unknown>;
  code?: string;
  inputSource?: string;
}

export interface NotificationItem {
  id: string;
  fragment: ZineFragment;
  duration: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'random';
  enteredAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FONT_FAMILIES = {
  serif: "'Georgia', 'Times New Roman', serif",
  sans: "system-ui, -apple-system, sans-serif",
  mono: "'Courier New', 'Lucida Console', monospace",
  impact: "'Impact', 'Arial Black', sans-serif",
  palatino: "'Palatino Linotype', 'Book Antiqua', serif",
  trebuchet: "'Trebuchet MS', 'Lucida Grande', sans-serif",
  segoe: "'Segoe UI', Tahoma, Geneva, sans-serif",
};

export const FRAGMENT_COLORS = [
  'rgba(255,255,255,0.95)',
  'rgba(255,255,255,0.7)',
  'rgba(255,255,255,0.45)',
  'rgba(200,180,255,0.9)',
  'rgba(180,220,255,0.9)',
  'rgba(255,200,180,0.85)',
  'rgba(180,255,200,0.8)',
  'rgba(255,220,100,0.9)',
  'rgba(255,140,200,0.85)',
  'rgba(140,255,255,0.8)',
];

export const ALL_ANIMATIONS: ZineAnimation[] = [
  'none', 'float', 'fade-in', 'slide-left', 'slide-right',
  'drop', 'drift', 'pulse', 'typewriter', 'spiral', 'glitch', 'dissolve',
];

// ---------------------------------------------------------------------------
// Templates (23)
// ---------------------------------------------------------------------------

export const TEMPLATES: ZineTemplate[] = [
  {
    id: 'freeform',
    name: 'Freeform Canvas',
    emoji: '✦',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'normal',
    maxVisible: 200,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-black',
    fonts: { heading: FONT_FAMILIES.impact, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.serif, mono: FONT_FAMILIES.mono },
    palette: { bg: '#000', text: 'rgba(255,255,255,0.9)', accent: 'rgba(200,180,255,0.9)', muted: 'rgba(255,255,255,0.3)', highlight: 'rgba(255,220,100,0.9)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 200, bordered: false },
    ],
  },
  {
    id: 'magazine',
    name: 'Magazine Spread',
    emoji: '📰',
    category: 'editorial',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 50,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-gradient-to-br from-[#0a0a0f] via-[#0f0a14] to-[#0a0f14]',
    gridTemplate: "'hero hero sidebar' 1fr 'body body sidebar' 2fr 'footer footer footer' auto / 1fr 1fr 280px",
    gridGap: '12px',
    fonts: { heading: FONT_FAMILIES.palatino, body: FONT_FAMILIES.serif, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0a0f', text: 'rgba(255,248,240,0.92)', accent: 'rgba(220,180,140,0.9)', muted: 'rgba(255,248,240,0.35)', highlight: 'rgba(255,200,120,0.95)' },
    zones: [
      { type: 'hero', gridArea: 'hero', overflow: 'hidden', maxFragments: 3, bordered: true, label: 'FEATURED' },
      { type: 'body', gridArea: 'body', overflow: 'scroll', maxFragments: 20, bordered: true, label: 'ARTICLES' },
      { type: 'sidebar', gridArea: 'sidebar', overflow: 'scroll', maxFragments: 10, bordered: true, label: 'DIGEST' },
      { type: 'footer', gridArea: 'footer', overflow: 'hidden', maxFragments: 5, bordered: true, label: 'TICKER' },
    ],
  },
  {
    id: 'newspaper',
    name: 'Newspaper Column',
    emoji: '🗞️',
    category: 'editorial',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 60,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-[#0d0c0a]',
    gridTemplate: "'title title title' auto 'col1 col2 col3' 1fr / 1fr 1fr 1fr",
    gridGap: '16px',
    fonts: { heading: FONT_FAMILIES.serif, body: FONT_FAMILIES.serif, accent: FONT_FAMILIES.sans, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0d0c0a', text: 'rgba(240,235,220,0.9)', accent: 'rgba(180,160,130,0.85)', muted: 'rgba(240,235,220,0.3)', highlight: 'rgba(220,200,160,0.9)' },
    zones: [
      { type: 'title', gridArea: 'title', overflow: 'hidden', maxFragments: 3, bordered: true, label: 'HEADLINES' },
      { type: 'body', gridArea: 'col1', overflow: 'scroll', maxFragments: 15, bordered: true, label: 'COLUMN I' },
      { type: 'body', gridArea: 'col2', overflow: 'scroll', maxFragments: 15, bordered: true, label: 'COLUMN II' },
      { type: 'sidebar', gridArea: 'col3', overflow: 'scroll', maxFragments: 15, bordered: true, label: 'COLUMN III' },
    ],
  },
  {
    id: 'punk-zine',
    name: 'Punk Zine',
    emoji: '🔥',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'dense',
    maxVisible: 150,
    defaultAnimation: 'drop',
    backgroundCSS: 'bg-[#0a0a0a]',
    overlayCSS: 'zine-punk-overlay',
    fonts: { heading: FONT_FAMILIES.impact, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0a0a', text: 'rgba(255,255,255,0.95)', accent: 'rgba(255,50,80,0.9)', muted: 'rgba(255,255,255,0.25)', highlight: 'rgba(255,220,0,0.95)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 150, bordered: false },
    ],
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    emoji: '🧱',
    category: 'experimental',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 80,
    defaultAnimation: 'none',
    backgroundCSS: 'bg-black',
    gridTemplate: "'full' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.mono, body: FONT_FAMILIES.mono, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#000', text: 'rgba(255,255,255,0.95)', accent: 'rgba(255,255,255,0.7)', muted: 'rgba(255,255,255,0.2)', highlight: 'rgba(255,255,255,1)' },
    zones: [
      { type: 'full', gridArea: 'full', overflow: 'scroll', maxFragments: 80, bordered: true },
    ],
  },
  {
    id: 'whisper',
    name: 'Whisper',
    emoji: '🌫️',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'sparse',
    maxVisible: 40,
    defaultAnimation: 'dissolve',
    backgroundCSS: 'bg-gradient-to-b from-[#050508] via-[#08080c] to-[#050508]',
    fonts: { heading: FONT_FAMILIES.serif, body: FONT_FAMILIES.serif, accent: FONT_FAMILIES.palatino, mono: FONT_FAMILIES.mono },
    palette: { bg: '#050508', text: 'rgba(255,255,255,0.3)', accent: 'rgba(200,200,220,0.25)', muted: 'rgba(255,255,255,0.08)', highlight: 'rgba(255,255,255,0.4)' },
    zones: [
      { type: 'full', bounds: { x: 5, y: 5, w: 90, h: 90 }, overflow: 'visible', maxFragments: 40, bordered: false },
    ],
  },
  {
    id: 'data-terminal',
    name: 'Data Terminal',
    emoji: '💻',
    category: 'data',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 100,
    defaultAnimation: 'typewriter',
    backgroundCSS: 'bg-[#0a0f0a]',
    gridTemplate: "'header header' auto 'main aside' 1fr 'ticker ticker' auto / 2fr 1fr",
    gridGap: '8px',
    fonts: { heading: FONT_FAMILIES.mono, body: FONT_FAMILIES.mono, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0f0a', text: 'rgba(100,255,180,0.85)', accent: 'rgba(80,200,255,0.8)', muted: 'rgba(100,255,180,0.25)', highlight: 'rgba(255,200,80,0.9)' },
    zones: [
      { type: 'title', gridArea: 'header', overflow: 'hidden', maxFragments: 3, bordered: true, label: '> HEADER' },
      { type: 'body', gridArea: 'main', overflow: 'scroll', maxFragments: 50, bordered: true, label: '> STDOUT' },
      { type: 'sidebar', gridArea: 'aside', overflow: 'scroll', maxFragments: 30, bordered: true, label: '> STDERR' },
      { type: 'ticker', gridArea: 'ticker', overflow: 'hidden', maxFragments: 5, bordered: true, label: '> STREAM' },
    ],
  },
  {
    id: 'art-deco',
    name: 'Art Deco',
    emoji: '🎭',
    category: 'editorial',
    displayMode: 'hybrid',
    density: 'sparse',
    maxVisible: 50,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-gradient-to-b from-[#0a0806] via-[#100c08] to-[#0a0806]',
    gridTemplate: "'hero' auto 'body' 1fr / 1fr",
    gridGap: '20px',
    fonts: { heading: FONT_FAMILIES.palatino, body: FONT_FAMILIES.serif, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0806', text: 'rgba(255,240,200,0.9)', accent: 'rgba(200,170,100,0.85)', muted: 'rgba(255,240,200,0.25)', highlight: 'rgba(255,200,80,0.95)' },
    zones: [
      { type: 'hero', gridArea: 'hero', overflow: 'hidden', maxFragments: 5, bordered: true, label: '✦ FEATURE' },
      { type: 'body', gridArea: 'body', overflow: 'scroll', maxFragments: 30, bordered: false },
      { type: 'floating', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 15, bordered: false },
    ],
  },
  {
    id: 'neon-board',
    name: 'Neon Board',
    emoji: '🌃',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'normal',
    maxVisible: 80,
    defaultAnimation: 'pulse',
    backgroundCSS: 'bg-gradient-to-br from-[#05000a] via-[#0a0015] to-[#050010]',
    fonts: { heading: FONT_FAMILIES.impact, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#05000a', text: 'rgba(255,255,255,0.9)', accent: 'rgba(255,50,200,0.9)', muted: 'rgba(100,50,200,0.3)', highlight: 'rgba(50,255,200,0.95)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 80, bordered: false },
    ],
  },
  {
    id: 'chalkboard',
    name: 'Chalkboard',
    emoji: '📝',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'normal',
    maxVisible: 80,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-[#1a1f1a]',
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.serif, mono: FONT_FAMILIES.mono },
    palette: { bg: '#1a1f1a', text: 'rgba(255,255,255,0.7)', accent: 'rgba(200,220,255,0.6)', muted: 'rgba(255,255,255,0.15)', highlight: 'rgba(255,255,200,0.7)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 80, bordered: false },
    ],
  },
  {
    id: 'message-board',
    name: 'Message Board',
    emoji: '📌',
    category: 'notification',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 60,
    defaultAnimation: 'drop',
    backgroundCSS: 'bg-gradient-to-br from-[#12100e] via-[#14120f] to-[#100e0c]',
    gridTemplate: "'board' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#12100e', text: 'rgba(40,35,30,0.95)', accent: 'rgba(80,70,50,0.8)', muted: 'rgba(40,35,30,0.4)', highlight: 'rgba(200,50,50,0.9)' },
    zones: [
      { type: 'full', gridArea: 'board', overflow: 'scroll', maxFragments: 60, bordered: false },
    ],
  },
  {
    id: 'rss-feed',
    name: 'RSS Feed',
    emoji: '📡',
    category: 'data',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 50,
    defaultAnimation: 'slide-left',
    backgroundCSS: 'bg-gradient-to-b from-[#0a0a12] via-[#0c0c16] to-[#0a0a12]',
    gridTemplate: "'feed' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.serif, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0a12', text: 'rgba(255,255,255,0.9)', accent: 'rgba(100,160,255,0.85)', muted: 'rgba(255,255,255,0.3)', highlight: 'rgba(255,160,60,0.9)' },
    zones: [
      { type: 'full', gridArea: 'feed', overflow: 'scroll', maxFragments: 50, bordered: false },
    ],
  },
  {
    id: 'notification-stream',
    name: 'Notification Stream',
    emoji: '🔔',
    category: 'notification',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 100,
    defaultAnimation: 'slide-right',
    backgroundCSS: 'bg-gradient-to-br from-[#0d0d1a] via-[#1a0d1a] to-[#0d1a1a]',
    gridTemplate: "'stream' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0d0d1a', text: 'rgba(255,255,255,0.9)', accent: 'rgba(140,120,255,0.85)', muted: 'rgba(255,255,255,0.25)', highlight: 'rgba(255,180,100,0.9)' },
    zones: [
      { type: 'full', gridArea: 'stream', overflow: 'scroll', maxFragments: 100, bordered: false },
    ],
  },
  // ========== NEW TEMPLATES ==========
  {
    id: 'vapor-wave',
    name: 'Vapor Wave',
    emoji: '🎮',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'normal',
    maxVisible: 60,
    defaultAnimation: 'glitch',
    backgroundCSS: 'bg-gradient-to-br from-[#1a0a2e] via-[#2d1b4e] to-[#1a0a2e]',
    fonts: { heading: FONT_FAMILIES.impact, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#1a0a2e', text: 'rgba(255,180,220,0.9)', accent: 'rgba(100,220,255,0.85)', muted: 'rgba(255,100,200,0.3)', highlight: 'rgba(255,220,100,0.95)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 60, bordered: false },
    ],
  },
  {
    id: 'led-wall',
    name: 'LED Wall',
    emoji: '🟩',
    category: 'data',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 120,
    defaultAnimation: 'pulse',
    backgroundCSS: 'bg-[#000800]',
    gridTemplate: "'led' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.mono, body: FONT_FAMILIES.mono, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#000800', text: 'rgba(0,255,0,0.9)', accent: 'rgba(0,200,0,0.8)', muted: 'rgba(0,100,0,0.4)', highlight: 'rgba(0,255,100,1)' },
    zones: [
      { type: 'full', gridArea: 'led', overflow: 'scroll', maxFragments: 120, bordered: false },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    emoji: '⬜',
    category: 'editorial',
    displayMode: 'bounded',
    density: 'sparse',
    maxVisible: 30,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-[#fafafa]',
    gridTemplate: "'main' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.sans, mono: FONT_FAMILIES.mono },
    palette: { bg: '#fafafa', text: 'rgba(20,20,20,0.9)', accent: 'rgba(100,100,100,0.7)', muted: 'rgba(200,200,200,0.5)', highlight: 'rgba(0,0,0,0.95)' },
    zones: [
      { type: 'full', gridArea: 'main', overflow: 'scroll', maxFragments: 30, bordered: false },
    ],
  },
  {
    id: 'timeline',
    name: 'Timeline',
    emoji: '📅',
    category: 'data',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 40,
    defaultAnimation: 'slide-left',
    backgroundCSS: 'bg-gradient-to-r from-[#0f172a] via-[#1e293b] to-[#0f172a]',
    gridTemplate: "'timeline' 1fr / 1fr",
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0f172a', text: 'rgba(226,232,240,0.9)', accent: 'rgba(148,163,184,0.85)', muted: 'rgba(71,85,105,0.4)', highlight: 'rgba(56,189,248,0.95)' },
    zones: [
      { type: 'full', gridArea: 'timeline', overflow: 'scroll', maxFragments: 40, bordered: false },
    ],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    emoji: '📊',
    category: 'data',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 80,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-[#0f172a]',
    gridTemplate: "'header header' auto 'stats stats' auto 'main main' 1fr 'footer footer' auto / 1fr 1fr",
    gridGap: '12px',
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0f172a', text: 'rgba(248,250,252,0.95)', accent: 'rgba(99,102,241,0.9)', muted: 'rgba(71,85,105,0.5)', highlight: 'rgba(52,211,153,0.95)' },
    zones: [
      { type: 'title', gridArea: 'header', overflow: 'hidden', maxFragments: 2, bordered: false, label: 'DASHBOARD' },
      { type: 'sidebar', gridArea: 'stats', overflow: 'scroll', maxFragments: 8, bordered: true, label: 'QUICK STATS' },
      { type: 'body', gridArea: 'main', overflow: 'scroll', maxFragments: 50, bordered: false, label: 'MAIN FEED' },
      { type: 'ticker', gridArea: 'footer', overflow: 'hidden', maxFragments: 4, bordered: false, label: 'LAST UPDATED' },
    ],
  },
  {
    id: 'split-screen',
    name: 'Split Screen',
    emoji: '🔀',
    category: 'editorial',
    displayMode: 'bounded',
    density: 'normal',
    maxVisible: 40,
    defaultAnimation: 'slide-left',
    backgroundCSS: 'bg-[#0c0c0c]',
    gridTemplate: "'left right' 1fr / 1fr 1fr",
    gridGap: '2px',
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.serif, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0c0c0c', text: 'rgba(255,255,255,0.9)', accent: 'rgba(255,255,255,0.6)', muted: 'rgba(255,255,255,0.2)', highlight: 'rgba(255,255,255,1)' },
    zones: [
      { type: 'body', gridArea: 'left', overflow: 'scroll', maxFragments: 20, bordered: false, label: 'PANEL A' },
      { type: 'body', gridArea: 'right', overflow: 'scroll', maxFragments: 20, bordered: false, label: 'PANEL B' },
    ],
  },
  {
    id: 'vintage-paper',
    name: 'Vintage Paper',
    emoji: '📜',
    category: 'editorial',
    displayMode: 'unbounded',
    density: 'sparse',
    maxVisible: 35,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-[#f4ecd8]',
    fonts: { heading: FONT_FAMILIES.serif, body: FONT_FAMILIES.serif, accent: FONT_FAMILIES.palatino, mono: FONT_FAMILIES.mono },
    palette: { bg: '#f4ecd8', text: 'rgba(60,50,40,0.9)', accent: 'rgba(120,80,40,0.8)', muted: 'rgba(150,130,110,0.4)', highlight: 'rgba(180,100,50,0.95)' },
    zones: [
      { type: 'full', bounds: { x: 5, y: 5, w: 90, h: 90 }, overflow: 'visible', maxFragments: 35, bordered: false },
    ],
  },
  {
    id: 'glass-morphism',
    name: 'Glass Morphism',
    emoji: '✨',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'sparse',
    maxVisible: 45,
    defaultAnimation: 'fade-in',
    backgroundCSS: 'bg-gradient-to-br from-[#667eea] via-[#764ba2] to-[#6dd5ed]',
    fonts: { heading: FONT_FAMILIES.sans, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.trebuchet, mono: FONT_FAMILIES.mono },
    palette: { bg: '#1a1a2e', text: 'rgba(255,255,255,0.9)', accent: 'rgba(255,255,255,0.7)', muted: 'rgba(255,255,255,0.3)', highlight: 'rgba(255,255,255,1)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 45, bordered: false },
    ],
  },
  {
    id: 'terminal-grid',
    name: 'Terminal Grid',
    emoji: '📟',
    category: 'data',
    displayMode: 'bounded',
    density: 'dense',
    maxVisible: 100,
    defaultAnimation: 'typewriter',
    backgroundCSS: 'bg-[#0c0c0c]',
    gridTemplate: "'info stats1 stats2' auto 'data data data' 1fr 'log log log' auto / 2fr 1fr 1fr",
    gridGap: '4px',
    fonts: { heading: FONT_FAMILIES.mono, body: FONT_FAMILIES.mono, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0c0c0c', text: 'rgba(0,255,0,0.85)', accent: 'rgba(255,255,0,0.8)', muted: 'rgba(0,128,0,0.4)', highlight: 'rgba(0,255,0,1)' },
    zones: [
      { type: 'title', gridArea: 'info', overflow: 'hidden', maxFragments: 2, bordered: true, label: 'TERM_INFO' },
      { type: 'sidebar', gridArea: 'stats1', overflow: 'scroll', maxFragments: 5, bordered: true, label: 'STAT_A' },
      { type: 'sidebar', gridArea: 'stats2', overflow: 'scroll', maxFragments: 5, bordered: true, label: 'STAT_B' },
      { type: 'body', gridArea: 'data', overflow: 'scroll', maxFragments: 60, bordered: true, label: 'DATA_STREAM' },
      { type: 'ticker', gridArea: 'log', overflow: 'hidden', maxFragments: 8, bordered: true, label: 'LOG_OUTPUT' },
    ],
  },
  {
    id: 'cyber-punk',
    name: 'Cyber Punk',
    emoji: '🤖',
    category: 'experimental',
    displayMode: 'unbounded',
    density: 'dense',
    maxVisible: 70,
    defaultAnimation: 'glitch',
    backgroundCSS: 'bg-gradient-to-br from-[#0a0a0f] via-[#1a0a1a] to-[#0a0a0f]',
    fonts: { heading: FONT_FAMILIES.impact, body: FONT_FAMILIES.sans, accent: FONT_FAMILIES.mono, mono: FONT_FAMILIES.mono },
    palette: { bg: '#0a0a0f', text: 'rgba(255,0,100,0.9)', accent: 'rgba(0,255,255,0.85)', muted: 'rgba(150,0,100,0.3)', highlight: 'rgba(255,255,0,0.95)' },
    zones: [
      { type: 'full', bounds: { x: 0, y: 0, w: 100, h: 100 }, overflow: 'visible', maxFragments: 70, bordered: false },
    ],
  },
];

export function getTemplate(id: string): ZineTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateAnimSeeds(): AnimationSeeds {
  return {
    floatDuration: rand(6, 12),
    dropInitialRotate: rand(-30, 30),
    dropFinalRotate: rand(-5, 5),
    driftX1: rand(-20, 20),
    driftX2: rand(-15, 15),
    driftDuration: rand(8, 16),
    pulseDuration: rand(3, 6),
    dataRainDuration: rand(8, 20),
    messageDriftDuration: rand(15, 35),
  };
}

export function generateStyle(
  type: FragmentType,
  template: ZineTemplate,
  zone?: ZoneType,
): FragmentStyle {
  const { palette, fonts, displayMode } = template;
  const allFonts = [fonts.heading, fonts.body, fonts.accent, fonts.mono];

  const base: FragmentStyle = {
    x: rand(5, 85),
    y: rand(5, 85),
    rotation: displayMode === 'bounded' ? 0 : rand(-15, 15),
    scale: 1,
    fontSize: 14,
    fontFamily: pick(allFonts),
    color: palette.text,
    opacity: rand(0.6, 1),
    zIndex: Math.floor(rand(1, 50)),
    textAlign: pick(['left', 'center', 'right'] as const),
    fontWeight: pick([300, 400, 500, 600, 700, 800]),
    letterSpacing: rand(-0.5, 3),
    lineHeight: rand(1.2, 1.7),
    textTransform: 'none',
    mixBlendMode: displayMode === 'unbounded' ? pick(['normal', 'screen', 'overlay']) : 'normal',
  };

  switch (type) {
    case 'heading':
      base.fontSize = rand(24, 56);
      base.fontFamily = fonts.heading;
      base.fontWeight = pick([700, 800, 900]);
      base.letterSpacing = rand(1, 8);
      base.textTransform = 'uppercase';
      base.opacity = rand(0.85, 1);
      base.color = palette.highlight;
      break;
    case 'quote':
      base.fontSize = rand(16, 26);
      base.fontFamily = fonts.accent ?? fonts.body;
      base.fontWeight = 400;
      base.rotation = displayMode === 'unbounded' ? rand(-6, 6) : 0;
      base.letterSpacing = rand(0, 1.5);
      base.color = palette.accent;
      break;
    case 'announcement':
      base.fontSize = rand(18, 34);
      base.fontWeight = pick([600, 700, 800]);
      base.textTransform = 'uppercase';
      base.letterSpacing = rand(2, 8);
      base.color = palette.highlight;
      break;
    case 'whisper':
      base.fontSize = rand(10, 15);
      base.fontWeight = 300;
      base.opacity = rand(0.15, 0.45);
      base.letterSpacing = rand(2, 8);
      base.textTransform = pick(['lowercase', 'none'] as const);
      base.color = palette.muted;
      break;
    case 'data':
      base.fontSize = rand(10, 13);
      base.fontFamily = fonts.mono;
      base.fontWeight = 400;
      base.color = template.id === 'data-terminal' ? palette.text : pick([palette.accent, palette.muted]);
      base.letterSpacing = rand(0, 1);
      break;
    case 'notification':
      base.fontSize = rand(12, 16);
      base.fontFamily = fonts.body;
      base.fontWeight = 500;
      base.color = palette.text;
      base.opacity = rand(0.8, 1);
      break;
    case 'ticker':
      base.fontSize = rand(11, 14);
      base.fontFamily = fonts.mono;
      base.fontWeight = 400;
      base.textTransform = 'uppercase';
      base.letterSpacing = rand(1, 4);
      base.color = palette.accent;
      break;
    case 'media':
      base.fontSize = rand(12, 18);
      base.fontFamily = fonts.accent;
      base.color = palette.accent;
      break;
    case 'text':
    default:
      base.fontSize = rand(12, 20);
      base.fontFamily = fonts.body;
      break;
  }

  // Template-specific overrides
  if (template.id === 'punk-zine') {
    base.rotation = rand(-25, 25);
    base.scale = rand(0.8, 1.5);
    base.mixBlendMode = pick(['normal', 'screen', 'difference', 'overlay']);
  } else if (template.id === 'whisper') {
    base.opacity = Math.min(base.opacity, 0.45);
    base.mixBlendMode = 'screen';
  } else if (template.id === 'chalkboard') {
    base.opacity = rand(0.3, 0.75);
    base.mixBlendMode = 'screen';
  } else if (template.id === 'neon-board') {
    base.mixBlendMode = pick(['normal', 'screen']);
  } else if (template.id === 'message-board') {
    base.rotation = rand(-4, 4);
    base.color = palette.text;
  }

  // Zone-based positioning for bounded layouts
  if (displayMode === 'bounded' && zone !== 'floating') {
    base.rotation = 0;
    base.x = 0;
    base.y = 0;
    base.mixBlendMode = 'normal';
  }

  return base;
}

export function createFragment(
  content: string,
  type: FragmentType,
  source: FragmentSource,
  animation: ZineAnimation,
  template: ZineTemplate,
  zone?: ZoneType,
  overrides?: Partial<ZineFragment>,
): ZineFragment {
  const style = generateStyle(type, template, zone);
  return {
    id: crypto.randomUUID(),
    content,
    type,
    source,
    style,
    animation,
    animSeeds: generateAnimSeeds(),
    zone: zone ?? assignZone(type, template),
    createdAt: Date.now(),
    ...overrides,
  };
}

export function assignZone(type: FragmentType, template: ZineTemplate): ZoneType {
  const zones = template.zones.map((z) => z.type);
  if (zones.length === 1) return zones[0];

  switch (type) {
    case 'heading':
    case 'announcement':
      if (zones.includes('hero')) return 'hero';
      if (zones.includes('title')) return 'title';
      return zones[0];
    case 'quote':
    case 'text':
      if (zones.includes('body')) return 'body';
      return zones[0];
    case 'data':
    case 'ticker':
      if (zones.includes('ticker')) return 'ticker';
      if (zones.includes('sidebar')) return 'sidebar';
      return zones[0];
    case 'whisper':
    case 'media':
      if (zones.includes('floating')) return 'floating';
      return zones[0];
    case 'notification':
      if (zones.includes('sidebar')) return 'sidebar';
      if (zones.includes('floating')) return 'floating';
      return zones[0];
    default:
      return zones[0];
  }
}

// ---------------------------------------------------------------------------
// AutoStyler — content type detection and optimal styling
// ---------------------------------------------------------------------------

export class AutoStyler {
  static detectType(content: string): FragmentType {
    const trimmed = content.trim();
    const upper = trimmed.toUpperCase();

    if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) return 'heading';
    if (trimmed.startsWith('> ')) return 'quote';
    if (trimmed.startsWith('! ') || trimmed.startsWith('!! ')) return 'announcement';
    if (trimmed.startsWith('~ ')) return 'whisper';
    if (trimmed.startsWith('$ ') || trimmed.startsWith('```')) return 'data';
    if (trimmed.startsWith('[notif]') || trimmed.startsWith('🔔')) return 'notification';
    if (trimmed.startsWith('[ticker]') || trimmed.startsWith('>>>')) return 'ticker';

    if (upper === trimmed && trimmed.length < 60 && trimmed.length > 2) return 'heading';
    if (trimmed.length < 20 && /^[a-z\s.,]+$/.test(trimmed)) return 'whisper';
    if (/^\{|^\[|https?:\/\/|@\w+/.test(trimmed)) return 'data';
    if (trimmed.length > 200) return 'text';
    if (/\d{4}-\d{2}|\d{1,2}:\d{2}|ago$|just now$/i.test(trimmed)) return 'notification';

    return 'text';
  }

  static stripPrefix(content: string): string {
    return content
      .replace(/^#+\s/, '')
      .replace(/^[>!~$]+\s/, '')
      .replace(/^```\s?/, '')
      .replace(/^\[notif\]\s?/i, '')
      .replace(/^\[ticker\]\s?/i, '')
      .replace(/^>>>\s?/, '')
      .replace(/^🔔\s?/, '')
      .trim();
  }

  static autoFragment(
    raw: string,
    source: FragmentSource,
    template: ZineTemplate,
  ): ZineFragment[] {
    const lines = raw.split('\n').filter((l) => l.trim());
    return lines.map((line) => {
      const type = AutoStyler.detectType(line);
      const content = AutoStyler.stripPrefix(line);
      const anim = AutoStyler.pickAnimation(type, template);
      return createFragment(content, type, source, anim, template);
    });
  }

  static pickAnimation(type: FragmentType, template: ZineTemplate): ZineAnimation {
    switch (type) {
      case 'heading': return pick(['fade-in', 'slide-left', 'drop'] as const);
      case 'announcement': return pick(['slide-left', 'slide-right', 'glitch'] as const);
      case 'whisper': return pick(['dissolve', 'drift', 'fade-in'] as const);
      case 'data': return pick(['typewriter', 'fade-in'] as const);
      case 'notification': return pick(['slide-right', 'fade-in', 'drop'] as const);
      case 'ticker': return 'slide-left';
      case 'quote': return pick(['float', 'fade-in'] as const);
      default: return template.defaultAnimation;
    }
  }

  static parseJsonInput(raw: string, template: ZineTemplate): ZineFragment[] {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => {
      const content = String(
        item.content || item.text || item.title || item.body || item.message || JSON.stringify(item),
      );
      const typeRaw = item.type as string;
      const validTypes: FragmentType[] = ['text', 'heading', 'quote', 'data', 'announcement', 'whisper', 'notification', 'media', 'ticker'];
      const type: FragmentType = validTypes.includes(typeRaw as FragmentType) ? (typeRaw as FragmentType) : AutoStyler.detectType(content);
      const anim: ZineAnimation = ALL_ANIMATIONS.includes(item.animation) ? item.animation : AutoStyler.pickAnimation(type, template);
      return createFragment(content, type, item.source || 'json', anim, template, undefined, {
        author: item.author,
        timestamp: item.timestamp || item.time || item.publishedAt,
        url: item.url || item.link,
        meta: item.meta,
      });
    });
  }

  static transformRSSItems(items: RSSItem[], template: ZineTemplate): ZineFragment[] {
    return items.map((item) => {
      const content = item.title || item.description || 'Untitled';
      const type: FragmentType = item.title && item.title.length < 80 ? 'heading' : 'text';
      const anim = AutoStyler.pickAnimation(type, template);
      return createFragment(content, type, 'rss', anim, template, undefined, {
        author: item.author,
        timestamp: item.publishedAt ? new Date(item.publishedAt).toLocaleString() : undefined,
        url: item.url,
        meta: { source: item.source, categories: item.categories },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// NotificationEngine — queue, lifecycle, subscribers
// ---------------------------------------------------------------------------

type NotificationCallback = (notifications: NotificationItem[]) => void;

export class NotificationEngine {
  private queue: NotificationItem[] = [];
  private subscribers: Set<NotificationCallback> = new Set();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private maxQueue = 200;

  push(
    fragment: ZineFragment,
    duration = 8000,
    position: NotificationItem['position'] = 'random',
  ): NotificationItem {
    const item: NotificationItem = {
      id: fragment.id,
      fragment,
      duration,
      position,
      enteredAt: Date.now(),
    };

    this.queue.push(item);
    if (this.queue.length > this.maxQueue) {
      const evicted = this.queue.shift();
      if (evicted) this.clearTimer(evicted.id);
    }

    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(item.id), duration);
      this.timers.set(item.id, timer);
    }

    this.notify();
    return item;
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.queue = this.queue.filter((n) => n.id !== id);
    this.notify();
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queue = [];
    this.notify();
  }

  getQueue(): NotificationItem[] {
    return [...this.queue];
  }

  subscribe(fn: NotificationCallback): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  destroy(): void {
    this.clear();
    this.subscribers.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private notify(): void {
    const snapshot = this.getQueue();
    for (const fn of this.subscribers) fn(snapshot);
  }
}

// ---------------------------------------------------------------------------
// DataSourceManager — pluggable connectors for RSS, webhook, API, URL, cron
// ---------------------------------------------------------------------------

export interface RSSItem {
  id: string;
  title: string;
  url: string;
  description: string;
  publishedAt?: number;
  author?: string;
  source?: string;
  categories?: string[];
}

type DataCallback = (fragments: ZineFragment[]) => void;

export class DataSourceManager {
  private sources: Map<string, DataSourceConfig> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private onData: DataCallback;
  private template: ZineTemplate;

  constructor(onData: DataCallback, template: ZineTemplate) {
    this.onData = onData;
    this.template = template;
  }

  setTemplate(template: ZineTemplate): void {
    this.template = template;
  }

  addSource(config: DataSourceConfig): void {
    this.sources.set(config.id, config);
    if (config.enabled) this.startPolling(config.id);
  }

  removeSource(id: string): void {
    this.stopPolling(id);
    this.sources.delete(id);
  }

  toggleSource(id: string): void {
    const src = this.sources.get(id);
    if (!src) return;
    src.enabled = !src.enabled;
    if (src.enabled) {
      this.startPolling(id);
    } else {
      this.stopPolling(id);
    }
  }

  getSources(): DataSourceConfig[] {
    return Array.from(this.sources.values());
  }

  async fetchSource(id: string): Promise<void> {
    const src = this.sources.get(id);
    if (!src) return;

    try {
      let fragments: ZineFragment[] = [];

      // Check for plugin-based source (config stored in transform field)
      if (src.transform) {
        try {
          const pluginConfig = JSON.parse(src.transform);
          const pluginId = pluginConfig._pluginId;
          
          if (pluginId) {
            const plugin = pluginRegistry.get(pluginId);
            if (plugin) {
              // Build full config with parsed plugin settings
              let headers: Record<string, string> | undefined;
              if (pluginConfig.headers) {
                try {
                  headers = typeof pluginConfig.headers === 'object' 
                    ? pluginConfig.headers 
                    : JSON.parse(pluginConfig.headers);
                } catch {
                  // Ignore parse errors, headers will be undefined
                }
              }

              const fullConfig: DataSourceConfig = {
                ...src,
                url: pluginConfig.url || pluginConfig.endpoint || src.url,
                method: pluginConfig.method,
                headers,
              };
              
              // Add remaining plugin config fields
              for (const [key, value] of Object.entries(pluginConfig)) {
                if (key !== '_pluginId' && key !== 'url' && key !== 'endpoint' && key !== 'headers') {
                  (fullConfig as unknown as Record<string, unknown>)[key] = value;
                }
              }
              
              try {
                fragments = await plugin.fetch(fullConfig, this.template);
              } catch (pluginErr) {
                console.error(`[DataSourceManager] Plugin "${pluginId}" fetch error:`, pluginErr);
                fragments = [];
              }
              
              if (fragments.length > 0) {
                src.lastFetchedAt = Date.now();
                this.onData(fragments);
              }
              return;
            }
          }
        } catch (parseErr) {
          console.warn('[DataSourceManager] Failed to parse plugin config:', parseErr);
        }
      }

      // Default source handlers
      switch (src.type) {
        case 'rss': {
          const params = new URLSearchParams();
          if (src.rssSource) params.set('source', src.rssSource);
          if (src.url) params.set('url', src.url);
          params.set('limit', '10');
          const res = await fetch(`/api/news/rss?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            fragments = AutoStyler.transformRSSItems(data.articles || [], this.template);
          }
          break;
        }
        case 'webhook': {
          const since = src.lastFetchedAt || 0;
          const res = await fetch(`/api/zine-display?type=poll&since=${since}`);
          if (res.ok) {
            const data = await res.json();
            if (data.items?.length) {
              fragments = AutoStyler.parseJsonInput(JSON.stringify(data.items), this.template);
            }
          }
          break;
        }
        case 'api':
        case 'url': {
          if (!src.url) break;
          const res = await fetch('/api/zine-display', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'fetch-url', url: src.url }),
          });
          if (res.ok) {
            const data = await res.json();
            const content = typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
            fragments = AutoStyler.autoFragment(content, src.type, this.template);
          }
          break;
        }
        case 'local': {
          const key = src.url || 'zine-local-data';
          const stored = localStorage.getItem(key);
          if (stored) {
            fragments = AutoStyler.autoFragment(stored, 'local', this.template);
          }
          break;
        }
        default:
          break;
      }

      if (fragments.length > 0) {
        src.lastFetchedAt = Date.now();
        this.onData(fragments);
      }
    } catch (err) {
      console.error(`[DataSourceManager] Error fetching source ${id}:`, err);
    }
  }

  destroy(): void {
    for (const id of this.intervals.keys()) this.stopPolling(id);
    this.sources.clear();
  }

  private startPolling(id: string): void {
    this.stopPolling(id);
    const src = this.sources.get(id);
    if (!src || !src.enabled) return;

    // Fetch immediately
    this.fetchSource(id);

    if (src.pollIntervalMs > 0) {
      const interval = setInterval(() => this.fetchSource(id), src.pollIntervalMs);
      this.intervals.set(id, interval);
    }
  }

  private stopPolling(id: string): void {
    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Animation variant builder
// ---------------------------------------------------------------------------

export function getAnimationProps(animation: ZineAnimation, index: number, seeds: AnimationSeeds) {
  const delay = index * 0.06;

  switch (animation) {
    case 'float':
      return {
        initial: { opacity: 0, y: 30 },
        animate: {
          opacity: 1,
          y: [0, -12, 0, 8, 0],
          transition: {
            opacity: { duration: 0.6, delay },
            y: { duration: seeds.floatDuration, repeat: Infinity, ease: 'easeInOut', delay },
          },
        },
        exit: { opacity: 0, scale: 0.8, transition: { duration: 0.3 } },
      };
    case 'fade-in':
      return {
        initial: { opacity: 0, scale: 0.7 },
        animate: { opacity: 1, scale: 1, transition: { duration: 0.8, delay, ease: 'easeOut' } },
        exit: { opacity: 0, transition: { duration: 0.3 } },
      };
    case 'slide-left':
      return {
        initial: { opacity: 0, x: 200 },
        animate: { opacity: 1, x: 0, transition: { duration: 0.7, delay, type: 'spring', damping: 20 } },
        exit: { opacity: 0, x: -200, transition: { duration: 0.4 } },
      };
    case 'slide-right':
      return {
        initial: { opacity: 0, x: -200 },
        animate: { opacity: 1, x: 0, transition: { duration: 0.7, delay, type: 'spring', damping: 20 } },
        exit: { opacity: 0, x: 200, transition: { duration: 0.4 } },
      };
    case 'drop':
      return {
        initial: { opacity: 0, y: -100, rotate: seeds.dropInitialRotate },
        animate: {
          opacity: 1, y: 0, rotate: seeds.dropFinalRotate,
          transition: { duration: 0.6, delay, type: 'spring', bounce: 0.4 },
        },
        exit: { opacity: 0, y: 100, transition: { duration: 0.3 } },
      };
    case 'drift':
      return {
        initial: { opacity: 0 },
        animate: {
          opacity: [0, 1, 1, 0.6, 1],
          x: [0, seeds.driftX1, seeds.driftX2, 0],
          transition: {
            opacity: { duration: 1.5, delay },
            x: { duration: seeds.driftDuration, repeat: Infinity, ease: 'easeInOut' },
          },
        },
        exit: { opacity: 0, transition: { duration: 0.5 } },
      };
    case 'pulse':
      return {
        initial: { opacity: 0 },
        animate: {
          opacity: [0.4, 1, 0.4],
          scale: [0.98, 1.02, 0.98],
          transition: { duration: seeds.pulseDuration, repeat: Infinity, ease: 'easeInOut', delay },
        },
        exit: { opacity: 0, transition: { duration: 0.3 } },
      };
    case 'typewriter':
      return {
        initial: { opacity: 0, width: 0 },
        animate: {
          opacity: 1, width: 'auto',
          transition: { opacity: { duration: 0.2, delay }, width: { duration: 1.2, delay, ease: 'easeOut' } },
        },
        exit: { opacity: 0, transition: { duration: 0.2 } },
      };
    case 'spiral':
      return {
        initial: { opacity: 0, scale: 0, rotate: -180 },
        animate: {
          opacity: 1, scale: 1, rotate: 0,
          transition: { duration: 1, delay, type: 'spring', stiffness: 100 },
        },
        exit: { opacity: 0, scale: 0, rotate: 180, transition: { duration: 0.4 } },
      };
    case 'glitch':
      return {
        initial: { opacity: 0, x: rand(-20, 20), skewX: rand(-10, 10) },
        animate: {
          opacity: [0, 1, 0.8, 1],
          x: [rand(-5, 5), 0, rand(-3, 3), 0],
          skewX: [rand(-3, 3), 0],
          transition: { duration: 0.6, delay, ease: 'easeOut' },
        },
        exit: { opacity: 0, x: rand(-30, 30), transition: { duration: 0.2 } },
      };
    case 'dissolve':
      return {
        initial: { opacity: 0, filter: 'blur(12px)' },
        animate: {
          opacity: 1, filter: 'blur(0px)',
          transition: { duration: 1.5, delay, ease: 'easeOut' },
        },
        exit: { opacity: 0, filter: 'blur(12px)', transition: { duration: 0.8 } },
      };
    case 'none':
    default:
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.3, delay } },
        exit: { opacity: 0, transition: { duration: 0.2 } },
      };
  }
}

// ---------------------------------------------------------------------------
// Sample fragments for initial load
// ---------------------------------------------------------------------------

export const SAMPLE_FRAGMENTS: { content: string; type: FragmentType; source: FragmentSource; animation: ZineAnimation }[] = [
  { content: 'BREAK THE GRID', type: 'heading', source: 'manual', animation: 'fade-in' },
  { content: 'content is not a rectangle', type: 'whisper', source: 'manual', animation: 'drift' },
  { content: 'The medium is the message. The container is the lie.', type: 'quote', source: 'manual', animation: 'float' },
  { content: 'DATA FLOWS WHERE IT WANTS', type: 'announcement', source: 'manual', animation: 'slide-left' },
  { content: 'v2.0 — advanced zine engine initialized', type: 'data', source: 'manual', animation: 'typewriter' },
  { content: 'no walls no borders no limits', type: 'text', source: 'manual', animation: 'pulse' },
  { content: 'INCOMING TRANSMISSION ▒▒▒▒▒', type: 'announcement', source: 'webhook', animation: 'slide-right' },
  { content: 'every pixel is a choice', type: 'whisper', source: 'manual', animation: 'spiral' },
  { content: '🔔 New connection established — feed active', type: 'notification', source: 'webhook', animation: 'drop' },
  { content: '>>> LIVE TICKER: System online. All feeds nominal.', type: 'ticker', source: 'manual', animation: 'slide-left' },
  // Discord webhook demo
  { content: '💬 Discord: New message in #general', type: 'notification', source: 'webhook', animation: 'drop' },
  // WhatsApp demo
  { content: '📱 WhatsApp: You have a new message', type: 'notification', source: 'webhook', animation: 'slide-right' },
  // Email notification demo
  { content: '📧 Email: New email from team@company.com', type: 'notification', source: 'webhook', animation: 'fade-in' },
  // Telegram demo
  { content: '✈️ Telegram: Message received from user', type: 'notification', source: 'webhook', animation: 'slide-left' },
];

// ---------------------------------------------------------------------------
// Webhook Source Presets - for external notification integration
// ---------------------------------------------------------------------------

export const WEBHOOK_SOURCES: DataSourceConfig[] = [
  { id: 'discord-hook', type: 'webhook', name: 'Discord Webhook', enabled: false, pollIntervalMs: 5000, url: '/api/zine-display/webhook' },
  { id: 'whatsapp-hook', type: 'webhook', name: 'WhatsApp (Twilio)', enabled: false, pollIntervalMs: 5000, url: '/api/zine-display/webhook' },
  { id: 'email-hook', type: 'webhook', name: 'Email (SendGrid)', enabled: false, pollIntervalMs: 10000, url: '/api/zine-display/webhook' },
  { id: 'telegram-hook', type: 'webhook', name: 'Telegram Bot', enabled: false, pollIntervalMs: 5000, url: '/api/zine-display/webhook' },
  { id: 'slack-hook', type: 'webhook', name: 'Slack Webhook', enabled: false, pollIntervalMs: 5000, url: '/api/zine-display/webhook' },
];

// ---------------------------------------------------------------------------
// Internal Feed Sources - for polling-based updates
// ---------------------------------------------------------------------------

export const FEED_SOURCES: DataSourceConfig[] = [
  { id: 'github-trending', type: 'api', name: 'GitHub Trending', enabled: false, pollIntervalMs: 120000, url: '/api/zine-display/feed?action=fetch&source=github-trending' },
  { id: 'stock-ticker', type: 'api', name: 'Stock Ticker', enabled: false, pollIntervalMs: 30000, url: '/api/zine-display/feed?action=fetch&source=stock-ticker' },
  { id: 'weather', type: 'api', name: 'Weather', enabled: false, pollIntervalMs: 300000, url: '/api/zine-display/feed?action=fetch&source=weather' },
  { id: 'system-status', type: 'api', name: 'System Status', enabled: false, pollIntervalMs: 60000, url: '/api/zine-display/feed?action=fetch&source=system-status' },
  { id: 'dev-quotes', type: 'api', name: 'Dev Quotes', enabled: false, pollIntervalMs: 180000, url: '/api/zine-display/feed?action=fetch&source=dev-quotes' },
  { id: 'crypto-ticker', type: 'api', name: 'Crypto Ticker', enabled: false, pollIntervalMs: 60000, url: '/api/zine-display/feed?action=fetch&source=crypto-ticker' },
  { id: 'reddit-hot', type: 'api', name: 'Reddit Hot', enabled: false, pollIntervalMs: 180000, url: '/api/zine-display/feed?action=fetch&source=reddit-hot' },
  { id: 'news-wire', type: 'api', name: 'News Wire', enabled: false, pollIntervalMs: 120000, url: '/api/zine-display/feed?action=fetch&source=news-wire' },
];

// ---------------------------------------------------------------------------
// Advanced Content Parsers - for different notification formats
// ---------------------------------------------------------------------------

export class AdvancedContentParser {
  // Parse Discord embed format
  static parseDiscordEmbed(embed: Record<string, unknown>): ZineFragment[] {
    const fragments: ZineFragment[] = [];
    
    if (embed.title) {
      fragments.push(createFragment(
        String(embed.title),
        'heading',
        'webhook',
        'fade-in',
        TEMPLATES[0],
      ));
    }
    
    if (embed.description) {
      fragments.push(createFragment(
        String(embed.description).slice(0, 500),
        'text',
        'webhook',
        'fade-in',
        TEMPLATES[0],
      ));
    }
    
    if ((embed.footer as any)?.text) {
      fragments.push(createFragment(
        String((embed.footer as any).text),
        'whisper',
        'webhook',
        'dissolve',
        TEMPLATES[0],
      ));
    }
    
    return fragments;
  }

  // Parse Telegram message with entities
  static parseTelegramMessage(message: Record<string, unknown>): ZineFragment[] {
    const text = String(message.text || message.caption || '');
    if (!text) return [];

    // Check for commands
    if (text.startsWith('/')) {
      return [createFragment(
        `Command: ${text}`,
        'data',
        'webhook',
        'typewriter',
        TEMPLATES[0],
      )];
    }

    return [createFragment(
      text.slice(0, 1000),
      AutoStyler.detectType(text) as FragmentType,
      'webhook',
      AutoStyler.pickAnimation(AutoStyler.detectType(text) as FragmentType, TEMPLATES[0]),
      TEMPLATES[0],
    )];
  }

  // Parse email with headers
  static parseEmail(email: Record<string, unknown>): ZineFragment[] {
    const subject = String(email.subject || '');
    const text = String(email.text || '');
    const from = String(email.from || 'Unknown');

    const fragments: ZineFragment[] = [];

    if (subject) {
      fragments.push(createFragment(
        subject,
        'heading',
        'webhook',
        'slide-left',
        TEMPLATES[0],
        undefined,
        { author: String(from).split('@')[0] },
      ));
    }

    if (text) {
      fragments.push(createFragment(
        text.slice(0, 800),
        'text',
        'webhook',
        'fade-in',
        TEMPLATES[0],
      ));
    }

    return fragments;
  }

  // Parse Slack message with blocks
  static parseSlackMessage(message: Record<string, unknown>): ZineFragment[] {
    const text = String(message.text || '');
    const user = String(message.user_name || 'Slack User');
    const channel = String(message.channel_name || '');

    const fragments: ZineFragment[] = [];

    if (channel) {
      fragments.push(createFragment(
        `#${channel}`,
        'data',
        'webhook',
        'slide-left',
        TEMPLATES[0],
      ));
    }

    if (text) {
      fragments.push(createFragment(
        `${user}: ${text}`,
        AutoStyler.detectType(text) as FragmentType,
        'webhook',
        'drop',
        TEMPLATES[0],
      ));
    }

    // Parse blocks if present
    if (message.blocks && Array.isArray(message.blocks)) {
      for (const block of message.blocks.slice(0, 3)) {
        if (block.text?.text) {
          fragments.push(createFragment(
            block.text.text.slice(0, 200),
            'text',
            'webhook',
            'fade-in',
            TEMPLATES[0],
          ));
        }
      }
    }

    return fragments;
  }

  // Auto-detect and parse based on content structure
  static autoParse(data: Record<string, unknown>, source: string): ZineFragment[] {
    switch (source) {
      case 'discord':
        if (data.embeds && Array.isArray(data.embeds) && data.embeds[0]) {
          return this.parseDiscordEmbed(data.embeds[0] as Record<string, unknown>);
        }
        return [createFragment(
          String(data.content || 'Discord message'),
          AutoStyler.detectType(String(data.content || '')) as FragmentType,
          'webhook',
          'drop',
          TEMPLATES[0],
        )];

      case 'telegram':
        return this.parseTelegramMessage((data.message as Record<string, unknown>) || data);

      case 'email':
        return this.parseEmail(data);

      case 'slack':
        return this.parseSlackMessage(data);

      case 'whatsapp':
        const msg = (data.messages as any[])?.[0];
        return [createFragment(
          msg?.text?.body || 'WhatsApp message',
          'text',
          'webhook',
          'slide-right',
          TEMPLATES[0],
        )];

      default:
        // Generic fallback
        const content = data.content || data.message || data.text || JSON.stringify(data);
        return [createFragment(
          typeof content === 'string' ? content : JSON.stringify(content).slice(0, 500),
          AutoStyler.detectType(typeof content === 'string' ? content : '') as FragmentType,
          'webhook',
          'fade-in',
          TEMPLATES[0],
        )];
    }
  }
}

// ---------------------------------------------------------------------------
// Modular Data Source Plugin System
// ---------------------------------------------------------------------------

/**
 * Base interface for data source plugins
 * Custom plugins can implement this to add new data source types
 */
export interface DataSourcePlugin {
  /** Unique identifier for the plugin */
  id: string;
  /** Display name */
  name: string;
  /** Icon emoji or identifier */
  icon: string;
  /** Plugin version */
  version: string;
  /** Description of what this plugin fetches */
  description: string;
  /** Supported configuration options */
  configSchema?: Record<string, { type: string; required: boolean; default?: unknown }>;
  /** Fetch data from the source */
  fetch(config: DataSourceConfig, template: ZineTemplate): Promise<ZineFragment[]>;
  /** Optional: Transform raw data before fragment creation */
  transform?: (data: unknown) => unknown;
  /** Optional: Test connection/config validity */
  test?: (config: DataSourceConfig) => Promise<boolean>;
}

/**
 * Registry of built-in and custom data source plugins
 */
export class DataSourcePluginRegistry {
  private plugins: Map<string, DataSourcePlugin> = new Map();

  /** Register a new plugin */
  register(plugin: DataSourcePlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[DataSourcePluginRegistry] Plugin "${plugin.id}" already registered, replacing`);
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`[DataSourcePluginRegistry] Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  /** Unregister a plugin */
  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  /** Get a plugin by ID */
  get(id: string): DataSourcePlugin | undefined {
    return this.plugins.get(id);
  }

  /** List all registered plugins */
  list(): DataSourcePlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get plugins by category */
  getByCategory(category: string): DataSourcePlugin[] {
    return this.list().filter(p => p.id.startsWith(category));
  }
}

// Global plugin registry instance
export const pluginRegistry = new DataSourcePluginRegistry();

// ---------------------------------------------------------------------------
// Built-in Plugin: REST API
// ---------------------------------------------------------------------------

const restApiPlugin: DataSourcePlugin = {
  id: 'rest-api',
  name: 'REST API',
  icon: '🌐',
  version: '1.0.0',
  description: 'Fetch data from any REST API endpoint',
  configSchema: {
    url: { type: 'string', required: true },
    method: { type: 'string', required: false, default: 'GET' },
    headers: { type: 'object', required: false },
    path: { type: 'string', required: false }, // JSON path to extract data
    pollIntervalMs: { type: 'number', required: false, default: 60000 },
  },
  async fetch(config, template) {
    const { url, method = 'GET', headers = {}, path } = config;
    
    try {
      const res = await fetch(url, { method, headers: headers as Record<string, string> });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const json = await res.json();
      let data = path ? jsonPath(json, path) : json;
      
      if (!Array.isArray(data)) data = [data];
      
      return (data as unknown[]).slice(0, 10).map((item: unknown) => {
        const content = typeof item === 'object' 
          ? JSON.stringify(item).slice(0, 200) 
          : String(item);
        return createFragment(content, 'data', 'api', 'typewriter', template, undefined, {
          url: (item as Record<string, unknown>)?.url as string,
          meta: { plugin: 'rest-api', source: url },
        });
      });
    } catch (err) {
      console.error('[rest-api] Fetch error:', err);
      return [];
    }
  },
  async test(config) {
    if (!config.url) return false;
    try {
      const res = await fetch(config.url, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in Plugin: Database Query
// ---------------------------------------------------------------------------

const databasePlugin: DataSourcePlugin = {
  id: 'database',
  name: 'Database Query',
  icon: '🗄️',
  version: '1.0.0',
  description: 'Execute queries against connected databases',
  configSchema: {
    connectionString: { type: 'string', required: true },
    query: { type: 'string', required: true },
    pollIntervalMs: { type: 'number', required: false, default: 60000 },
  },
  async fetch(config, template) {
    // In production, this would connect to actual databases
    // For now, return mock data representing database results
    const mockRows = [
      { id: 1, name: 'User Registration', count: 142 },
      { id: 2, name: 'Active Sessions', count: 89 },
      { id: 3, name: 'API Calls', count: 1247 },
    ];
    
    return mockRows.map(row => createFragment(
      `${row.name}: ${row.count}`,
      'data',
      'api',
      'fade-in',
      template,
      undefined,
      { meta: { plugin: 'database', row } },
    ));
  },
  async test(config) {
    if (!config.url && !config.transform) return false;
    // Database test requires connection string in transform
    try {
      const pluginConfig = config.transform ? JSON.parse(config.transform) : {};
      if (!pluginConfig.connectionString) {
        // No connection string - can't test without one
        return false;
      }
      // In production, would test actual database connection
      // For now, validate connection string format
      return pluginConfig.connectionString.length > 0;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in Plugin: WebSocket Stream
// ---------------------------------------------------------------------------

const websocketPlugin: DataSourcePlugin = {
  id: 'websocket',
  name: 'WebSocket Stream',
  icon: '🔌',
  version: '1.0.0',
  description: 'Connect to WebSocket endpoints for real-time data',
  configSchema: {
    url: { type: 'string', required: true },
    filter: { type: 'string', required: false }, // JSONPath filter
  },
  async fetch(config, template) {
    // WebSocket handling would be done client-side
    // This returns a placeholder fragment
    return [createFragment(
      `WebSocket: ${config.url}`,
      'data',
      'api',
      'slide-right',
      template,
      undefined,
      { meta: { plugin: 'websocket', url: config.url } },
    )];
  },
  async test(config) {
    if (!config.url) return false;
    // WebSocket URL validation (must start with ws:// or wss://)
    const url = config.url.toLowerCase();
    return url.startsWith('ws://') || url.startsWith('wss://');
  },
};

// ---------------------------------------------------------------------------
// Built-in Plugin: GraphQL
// ---------------------------------------------------------------------------

const graphqlPlugin: DataSourcePlugin = {
  id: 'graphql',
  name: 'GraphQL',
  icon: '◼️',
  version: '1.0.0',
  description: 'Query GraphQL endpoints',
  configSchema: {
    endpoint: { type: 'string', required: true },
    query: { type: 'string', required: true },
    variables: { type: 'object', required: false },
  },
  async fetch(config, template) {
    const { endpoint, query, variables = {} } = config;
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      
      const json = await res.json();
      const data = json.data;
      
      if (typeof data === 'object' && data !== null) {
        const items = Array.isArray(data) ? data : Object.values(data).flat().slice(0, 5);
        return (items as unknown[]).map(item => createFragment(
          JSON.stringify(item).slice(0, 150),
          'data',
          'api',
          'typewriter',
          template,
          undefined,
          { meta: { plugin: 'graphql' } },
        ));
      }
    } catch (err) {
      console.error('[graphql] Error:', err);
    }
    return [];
  },
  async test(config) {
    if (!config.url && !config.endpoint) return false;
    const endpoint = config.url || config.endpoint;
    try {
      // Send introspection query to validate endpoint
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __schema { types { name } } }' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in Plugin: Custom JavaScript
// ---------------------------------------------------------------------------

const customJsPlugin: DataSourcePlugin = {
  id: 'custom-js',
  name: 'Custom JS',
  icon: '⚡',
  version: '1.0.0',
  description: 'Execute custom JavaScript to transform data',
  configSchema: {
    code: { type: 'string', required: true },
    inputSource: { type: 'string', required: false },
  },
  async fetch(config, template) {
    const { code } = config;
    try {
      // Safe custom code execution - in production would use a sandbox
      const fn = new Function('data', code);
      const result = fn({ timestamp: Date.now(), template: template.id });
      
      if (typeof result === 'string') {
        return [createFragment(result, 'data', 'api', 'fade-in', template)];
      }
      if (Array.isArray(result)) {
        return result.map((item: unknown) => createFragment(
          String(item), 'data', 'api', 'fade-in', template,
        ));
      }
    } catch (err) {
      console.error('[custom-js] Error:', err);
    }
    return [];
  },
  async test(config) {
    // Test code syntax by attempting to parse it
    let code = '';
    try {
      if (config.code) {
        code = config.code;
      } else if (config.transform) {
        const pluginConfig = JSON.parse(config.transform);
        code = pluginConfig.code || '';
      }
    } catch {
      // Invalid JSON - can't test
      return false;
    }
    
    if (!code) return false;
    try {
      // Try to create function to validate syntax (won't execute, just parse)
      new Function('data', code);
      return true;
    } catch {
      return false;
    }
  },
};

// Helper: simple JSON path extraction (defined before plugins that use it)
function jsonPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\.?(?:\.|\[|\])/g, '').split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// Register built-in plugins
pluginRegistry.register(restApiPlugin);
pluginRegistry.register(databasePlugin);
pluginRegistry.register(websocketPlugin);
pluginRegistry.register(graphqlPlugin);
pluginRegistry.register(customJsPlugin);

// ---------------------------------------------------------------------------
// NOTE: Custom JS plugin uses new Function() which is not sandboxed.
// In production, use vm2 or isolated-vm for safe execution.
// ---------------------------------------------------------------------------
// Predefined data source presets

// ---------------------------------------------------------------------------
// Predefined data source presets
// ---------------------------------------------------------------------------

export const SOURCE_PRESETS: DataSourceConfig[] = [
  { id: 'hn-rss', type: 'rss', name: 'Hacker News', enabled: false, rssSource: 'hn', pollIntervalMs: 300000 },
  { id: 'techcrunch-rss', type: 'rss', name: 'TechCrunch', enabled: false, rssSource: 'techcrunch', pollIntervalMs: 300000 },
  { id: 'verge-rss', type: 'rss', name: 'The Verge', enabled: false, rssSource: 'verge', pollIntervalMs: 300000 },
  { id: 'webhook-poll', type: 'webhook', name: 'Webhook Inbox', enabled: false, pollIntervalMs: 15000 },
];

// ---------------------------------------------------------------------------
// Responsive Template Overrides
// ---------------------------------------------------------------------------

/**
 * Mobile-responsive template overrides
 * Adjusts grid layouts for smaller screens
 */
export interface ResponsiveTemplateOverride {
  breakpoint: 'mobile' | 'tablet' | 'desktop' | 'wide';
  gridTemplate?: string;
  gridGap?: string;
  fontScale?: number;
  zoneVisibility?: Record<string, 'show' | 'hide' | 'collapse'>;
}

/**
 * Get responsive grid template based on viewport size
 */
export function getResponsiveGridTemplate(
  template: ZineTemplate,
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): string | undefined {
  // Mobile overrides for multi-column templates
  if (viewportSize === 'mobile') {
    switch (template.id) {
      case 'magazine':
        return "'hero' auto 'body' 1fr 'sidebar' auto / 1fr";
      case 'newspaper':
        return "'title' auto 'col1' 1fr 'col2' 1fr / 1fr";
      case 'data-terminal':
        return "'header' auto 'main' 1fr 'aside' auto 'ticker' auto / 1fr";
      case 'art-deco':
        // Art Deco: Stack hero and body vertically on mobile, hide floating elements
        return "'hero' auto 'body' 1fr / 1fr";
      case 'brutalist':
        return "'full' 1fr / 1fr";
      case 'message-board':
        return "'board' 1fr / 1fr";
      case 'rss-feed':
        return "'feed' 1fr / 1fr";
      case 'notification-stream':
        return "'stream' 1fr / 1fr";
      case 'vapor-wave':
        return "'full' 1fr / 1fr";
      case 'led-wall':
        return "'led' 1fr / 1fr";
      case 'minimal':
        return "'main' 1fr / 1fr";
      case 'timeline':
        return "'timeline' 1fr / 1fr";
      case 'dashboard':
        return "'header' auto 'main' 1fr / 1fr";
      case 'split-screen':
        return "'left' 1fr / 1fr";
      case 'vintage-paper':
        return "'full' 1fr / 1fr";
      case 'glass-morphism':
        return "'full' 1fr / 1fr";
      case 'terminal-grid':
        return "'info' auto 'data' 1fr 'log' auto / 1fr";
      case 'cyber-punk':
        return "'full' 1fr / 1fr";
      default:
        return undefined;
    }
  }
  
  if (viewportSize === 'tablet') {
    switch (template.id) {
      case 'magazine':
        return "'hero hero' auto 'body sidebar sidebar' 1fr / 1fr 1fr";
      case 'newspaper':
        return "'title title title' auto 'col1 col2' 1fr / 1fr 1fr";
      case 'data-terminal':
        return "'header header' auto 'main aside' 1fr / 1fr 1fr";
      case 'art-deco':
        // Art Deco: Two-column on tablet
        return "'hero hero' auto 'body body' 1fr / 1fr 1fr";
      case 'brutalist':
        return "'full' 1fr / 1fr";
      case 'vapor-wave':
        return "'full' 1fr / 1fr";
      case 'led-wall':
        return "'led' 1fr / 1fr";
      case 'minimal':
        return "'main' 1fr / 1fr";
      case 'timeline':
        return "'timeline' 1fr / 1fr";
      case 'dashboard':
        return "'header header' auto 'stats stats' auto 'main main' 1fr / 1fr 1fr";
      case 'split-screen':
        return "'left right' 1fr / 1fr 1fr";
      case 'vintage-paper':
        return "'full' 1fr / 1fr";
      case 'glass-morphism':
        return "'full' 1fr / 1fr";
      case 'terminal-grid':
        return "'info stats1 stats2' auto 'data data data' 1fr 'log log log' auto / 1fr 1fr 1fr";
      case 'cyber-punk':
        return "'full' 1fr / 1fr";
      default:
        return undefined;
    }
  }
  
  // Wide/desktop: use original template with potential adjustments
  if (viewportSize === 'wide') {
    switch (template.id) {
      case 'art-deco':
        return "'hero hero' auto 'body body' 1fr / 1fr 1fr";
      case 'dashboard':
        return "'header header header' auto 'stats stats stats' auto 'main main main' 1fr / 1fr 1fr 1fr";
      case 'split-screen':
        return "'left right' 1fr / 1fr 1fr";
      case 'terminal-grid':
        return "'info stats1 stats2' auto 'data data data' 1fr 'log log log' auto / 2fr 1fr 1fr";
      default:
        break;
    }
  }
  
  return template.gridTemplate;
}

/**
 * Get responsive zone visibility based on viewport
 * Returns which zones should be shown, hidden, or collapsed
 */
export function getZoneVisibility(
  template: ZineTemplate,
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): Record<string, 'show' | 'hide' | 'collapse'> {
  const visibility: Record<string, 'show' | 'hide' | 'collapse'> = {};
  
  // Default: all zones shown
  for (const zone of template.zones) {
    const key = zone.gridArea ?? zone.type;
    visibility[key] = 'show';
  }
  
  // Mobile-specific zone visibility
  if (viewportSize === 'mobile') {
    // Hide sidebar on mobile, collapse footer
    switch (template.id) {
      case 'magazine':
        visibility['sidebar'] = 'hide';
        visibility['footer'] = 'collapse';
        break;
      case 'newspaper':
        visibility['col3'] = 'hide';
        break;
      case 'data-terminal':
        visibility['aside'] = 'collapse';
        visibility['ticker'] = 'collapse';
        break;
      case 'art-deco':
        // Hide floating elements on mobile for cleaner layout
        visibility['floating'] = 'hide';
        break;
      case 'neon-board':
        // Keep full zone visible but reduce fragments count for mobile
        // Visibility stays as 'show' by default for unbounded templates
        break;
      case 'brutalist':
      case 'message-board':
      case 'rss-feed':
      case 'notification-stream':
        // Single-zone templates - no visibility changes needed
        break;
      default:
        break;
    }
  }
  
  // Tablet-specific zone visibility
  if (viewportSize === 'tablet') {
    switch (template.id) {
      case 'magazine':
        visibility['sidebar'] = 'collapse';
        break;
      case 'data-terminal':
        visibility['aside'] = 'collapse';
        break;
      case 'art-deco':
        // Collapse floating elements on tablet
        visibility['floating'] = 'collapse';
        break;
      case 'neon-board':
        // Single unbounded zone - no visibility changes needed
        break;
      case 'dashboard':
        visibility['footer'] = 'collapse';
        break;
      case 'split-screen':
        visibility['right'] = 'hide';
        break;
      case 'terminal-grid':
        visibility['stats1'] = 'collapse';
        visibility['stats2'] = 'collapse';
        break;
      default:
        break;
    }
  }
  
  // Wide-specific zone visibility
  if (viewportSize === 'wide') {
    switch (template.id) {
      case 'art-deco':
        visibility['floating'] = 'show';
        break;
      case 'dashboard':
        visibility['footer'] = 'show';
        break;
      case 'split-screen':
        visibility['right'] = 'show';
        break;
      case 'terminal-grid':
        visibility['stats1'] = 'show';
        visibility['stats2'] = 'show';
        break;
      default:
        break;
    }
  }
  
  return visibility;
}

/**
 * Apply responsive grid columns to a template's zone configuration
 */
export function getZoneColumns(
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): number {
  const columns: Record<string, number> = {
    mobile: 1,
    tablet: 2,
    desktop: 3,
    wide: 4,
  };
  return columns[viewportSize];
}

/**
 * Get responsive gap (spacing between grid items) based on template and viewport
 */
export function getResponsiveGap(
  template: ZineTemplate,
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): string {
  // Template-specific gap overrides
  const templateGaps: Record<string, Record<string, string>> = {
    magazine: {
      mobile: '8px',
      tablet: '10px',
      desktop: '12px',
      wide: '16px',
    },
    newspaper: {
      mobile: '8px',
      tablet: '12px',
      desktop: '16px',
      wide: '20px',
    },
    "data-terminal": {
      mobile: '4px',
      tablet: '6px',
      desktop: '8px',
      wide: '10px',
    },
    "art-deco": {
      mobile: '12px',
      tablet: '16px',
      desktop: '20px',
      wide: '24px',
    },
    brutalist: {
      mobile: '0px',
      tablet: '0px',
      desktop: '2px',
      wide: '4px',
    },
    "neon-board": {
      mobile: '16px',
      tablet: '20px',
      desktop: '24px',
      wide: '32px',
    },
    "message-board": {
      mobile: '8px',
      tablet: '10px',
      desktop: '12px',
      wide: '16px',
    },
    'rss-feed': {
      mobile: '6px',
      tablet: '8px',
      desktop: '10px',
      wide: '14px',
    },
    'notification-stream': {
      mobile: '4px',
      tablet: '6px',
      desktop: '8px',
      wide: '12px',
    },
    freeform: {
      mobile: '0px',
      tablet: '0px',
      desktop: '0px',
      wide: '0px',
    },
    'punk-zine': {
      mobile: '0px',
      tablet: '0px',
      desktop: '4px',
      wide: '8px',
    },
    'whisper': {
      mobile: '20px',
      tablet: '24px',
      desktop: '32px',
      wide: '40px',
    },
    'chalkboard': {
      mobile: '12px',
      tablet: '16px',
      desktop: '20px',
      wide: '24px',
    },
    'vapor-wave': {
      mobile: '16px',
      tablet: '20px',
      desktop: '24px',
      wide: '32px',
    },
    'led-wall': {
      mobile: '2px',
      tablet: '2px',
      desktop: '4px',
      wide: '4px',
    },
    'minimal': {
      mobile: '8px',
      tablet: '12px',
      desktop: '16px',
      wide: '20px',
    },
    'timeline': {
      mobile: '8px',
      tablet: '10px',
      desktop: '12px',
      wide: '16px',
    },
    'dashboard': {
      mobile: '6px',
      tablet: '8px',
      desktop: '12px',
      wide: '16px',
    },
    'split-screen': {
      mobile: '0px',
      tablet: '1px',
      desktop: '2px',
      wide: '2px',
    },
    'vintage-paper': {
      mobile: '12px',
      tablet: '16px',
      desktop: '20px',
      wide: '24px',
    },
    'glass-morphism': {
      mobile: '20px',
      tablet: '24px',
      desktop: '32px',
      wide: '40px',
    },
    'terminal-grid': {
      mobile: '2px',
      tablet: '3px',
      desktop: '4px',
      wide: '4px',
    },
    'cyber-punk': {
      mobile: '8px',
      tablet: '12px',
      desktop: '16px',
      wide: '20px',
    },
  };

  const templateOverrides = templateGaps[template.id];
  if (templateOverrides) {
    return templateOverrides[viewportSize];
  }

  // Default gaps based on viewport
  const defaultGaps: Record<string, string> = {
    mobile: '8px',
    tablet: '10px',
    desktop: '12px',
    wide: '16px',
  };

  return defaultGaps[viewportSize];
}

/**
 * Get responsive font scale factor based on template and viewport
 * Reduces font sizes on smaller screens for templates with large decorative fonts
 */
export function getResponsiveFontScale(
  template: ZineTemplate,
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): number {
  // Templates with large decorative fonts need font size reduction on mobile
  const decorativeFontTemplates: Record<string, Record<string, number>> = {
    // Impact/Palatino heading fonts - significant scaling on mobile
    "art-deco": {
      mobile: 0.7,
      tablet: 0.85,
      desktop: 1.0,
      wide: 1.15,
    },
    "neon-board": {
      mobile: 0.65,
      tablet: 0.8,
      desktop: 1.0,
      wide: 1.2,
    },
    'vapor-wave': {
      mobile: 0.7,
      tablet: 0.85,
      desktop: 1.0,
      wide: 1.15,
    },
    'cyber-punk': {
      mobile: 0.7,
      tablet: 0.85,
      desktop: 1.0,
      wide: 1.1,
    },
    'punk-zine': {
      mobile: 0.75,
      tablet: 0.9,
      desktop: 1.0,
      wide: 1.1,
    },
    freeform: {
      mobile: 0.8,
      tablet: 0.9,
      desktop: 1.0,
      wide: 1.1,
    },
    whisper: {
      // Whisper uses small fonts - less scaling needed
      mobile: 0.9,
      tablet: 0.95,
      desktop: 1.0,
      wide: 1.05,
    },
    'vintage-paper': {
      // Serif fonts - moderate scaling
      mobile: 0.8,
      tablet: 0.9,
      desktop: 1.0,
      wide: 1.1,
    },
    'glass-morphism': {
      mobile: 0.85,
      tablet: 0.95,
      desktop: 1.0,
      wide: 1.05,
    },
    // Data/terminal templates - monospace, less scaling needed
    'data-terminal': {
      mobile: 0.9,
      tablet: 0.95,
      desktop: 1.0,
      wide: 1.0,
    },
    'led-wall': {
      mobile: 0.95,
      tablet: 1.0,
      desktop: 1.0,
      wide: 1.0,
    },
    'terminal-grid': {
      mobile: 0.9,
      tablet: 0.95,
      desktop: 1.0,
      wide: 1.0,
    },
  };

  const templateScale = decorativeFontTemplates[template.id];
  if (templateScale) {
    return templateScale[viewportSize];
  }

  // Default: slight reduction on mobile, full size on desktop+
  const defaultScales: Record<string, number> = {
    mobile: 0.85,
    tablet: 0.95,
    desktop: 1.0,
    wide: 1.0,
  };

  return defaultScales[viewportSize];
}

/**
 * Get responsive padding (inner spacing) based on template and viewport
 */
export function getResponsivePadding(
  template: ZineTemplate,
  viewportSize: 'mobile' | 'tablet' | 'desktop' | 'wide',
): number {
  // Template-specific padding overrides
  const templatePaddings: Record<string, Record<string, number>> = {
    magazine: {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    newspaper: {
      mobile: 6,
      tablet: 10,
      desktop: 14,
      wide: 18,
    },
    "data-terminal": {
      mobile: 4,
      tablet: 6,
      desktop: 8,
      wide: 10,
    },
    "art-deco": {
      mobile: 10,
      tablet: 16,
      desktop: 20,
      wide: 28,
    },
    brutalist: {
      mobile: 4,
      tablet: 6,
      desktop: 8,
      wide: 12,
    },
    "neon-board": {
      mobile: 12,
      tablet: 16,
      desktop: 20,
      wide: 24,
    },
    "message-board": {
      mobile: 6,
      tablet: 10,
      desktop: 14,
      wide: 18,
    },
    'rss-feed': {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    'notification-stream': {
      mobile: 6,
      tablet: 8,
      desktop: 12,
      wide: 16,
    },
    'freeform': {
      mobile: 16,
      tablet: 20,
      desktop: 24,
      wide: 32,
    },
    'punk-zine': {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    whisper: {
      mobile: 24,
      tablet: 32,
      desktop: 40,
      wide: 48,
    },
    chalkboard: {
      mobile: 12,
      tablet: 16,
      desktop: 20,
      wide: 24,
    },
    'vapor-wave': {
      mobile: 16,
      tablet: 20,
      desktop: 24,
      wide: 32,
    },
    'led-wall': {
      mobile: 4,
      tablet: 6,
      desktop: 8,
      wide: 10,
    },
    minimal: {
      mobile: 16,
      tablet: 24,
      desktop: 32,
      wide: 40,
    },
    timeline: {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    dashboard: {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    'split-screen': {
      mobile: 8,
      tablet: 12,
      desktop: 16,
      wide: 20,
    },
    'vintage-paper': {
      mobile: 20,
      tablet: 24,
      desktop: 32,
      wide: 40,
    },
    'glass-morphism': {
      mobile: 20,
      tablet: 24,
      desktop: 32,
      wide: 40,
    },
    'terminal-grid': {
      mobile: 4,
      tablet: 6,
      desktop: 8,
      wide: 10,
    },
    'cyber-punk': {
      mobile: 12,
      tablet: 16,
      desktop: 20,
      wide: 24,
    },
  };

  const templateOverrides = templatePaddings[template.id];
  if (templateOverrides) {
    return templateOverrides[viewportSize];
  }

  // Default padding based on viewport
  const defaultPaddings: Record<string, number> = {
    mobile: 8,
    tablet: 12,
    desktop: 16,
    wide: 20,
  };

  return defaultPaddings[viewportSize];
}
