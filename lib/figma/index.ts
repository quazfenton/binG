/**
 * Figma Integration Module
 * 
 * Complete Figma integration for binG workspace:
 * - OAuth 2.0 authentication with PKCE
 * - REST API client for Figma operations
 * - Figma to Craft.js converter for visual editor import
 * - React plugin component for UI
 * 
 * @module @/lib/figma
 */

// Configuration
export {
  FIGMA_OAUTH_CONFIG,
  FIGMA_API_BASE,
  isFigmaConfigured,
  getFigmaClientId,
  getFigmaClientSecret,
  getFigmaRedirectUri,
  validateFigmaConfig,
} from './config';

// OAuth
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateAuthUrl,
  exchangeCodeForToken,
  refreshToken,
  isTokenExpired,
  calculateExpiryDate,
  type FigmaTokenResponse,
  type FigmaTokenData,
} from './oauth';

// API Client
export {
  createFigmaApi,
  FigmaApiError,
  type FigmaApi,
} from './api';

// Types (re-export all from types.ts)
export * from './types';

// Converter
export {
  convertFigmaToCraft,
  convertFigmaNodesToCraft,
  loadCraftJson,
  serializeCraftJson,
  type CraftNode,
  type CraftNodesMap,
  type ConversionResult,
} from './converter';
