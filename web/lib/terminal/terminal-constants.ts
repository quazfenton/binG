/**
 * Terminal Constants and Configuration
 * 
 * Centralized configuration for terminal limits and timeouts
 */

export const TERMINAL_LIMITS = {
  // Input/Output limits
  MAX_INPUT_SIZE: parseInt(process.env.TERMINAL_MAX_INPUT_SIZE || '10240', 10), // 10KB per input
  MAX_BUFFER_SIZE: parseInt(process.env.TERMINAL_MAX_BUFFER_SIZE || '10240', 10), // 10KB command buffer
  MAX_WEBSOCKET_MESSAGE_SIZE: parseInt(process.env.TERMINAL_MAX_WEBSOCKET_MESSAGE_SIZE || '10240', 10), // 10KB
  
  // Rate limiting
  MAX_COMMANDS_PER_SECOND: parseInt(process.env.TERMINAL_MAX_COMMANDS_PER_SECOND || '5', 10),
  MAX_SANDBOX_CREATIONS_PER_MINUTE: parseInt(process.env.SANDBOX_CREATION_RATE_LIMIT || '3', 10),
  MAX_WEBSOCKET_CONNECTIONS_PER_MINUTE: parseInt(process.env.WEBSOCKET_CONNECTION_RATE_LIMIT || '10', 10),
  
  // Timeouts
  CONNECTION_TIMEOUT_MS: parseInt(process.env.TERMINAL_CONNECTION_TIMEOUT_MS || '30000', 10), // 30 seconds
  IDLE_TIMEOUT_MS: parseInt(process.env.TERMINAL_IDLE_TIMEOUT_MS || '300000', 10), // 5 minutes
  PING_INTERVAL_MS: 30000, // 30 seconds
  PONG_TIMEOUT_MS: 60000, // 60 seconds
  CLEANUP_INTERVAL_MS: 60000, // 1 minute
  
  // Session limits
  MAX_SESSIONS_PER_USER: parseInt(process.env.TERMINAL_MAX_SESSIONS_PER_USER || '3', 10),
  MAX_RECONNECT_ATTEMPTS: parseInt(process.env.TERMINAL_MAX_RECONNECT_ATTEMPTS || '5', 10),
  RECONNECT_BASE_DELAY_MS: 1000,
  
  // Resource limits
  MAX_ACTIVE_CONNECTIONS: 100,
  MAX_COMMAND_HISTORY: 100,
} as const;

export const TERMINAL_CONFIG = {
  // Security
  ENABLE_OBFUSCATION_DETECTION: process.env.TERMINAL_ENABLE_OBFUSCATION_DETECTION !== 'false',
  BLOCK_ON_OBFUSCATION: process.env.TERMINAL_BLOCK_ON_OBFUSCATION === 'true',
  LOG_BLOCKED_COMMANDS: process.env.TERMINAL_LOG_BLOCKED_COMMANDS !== 'false',
  
  // Session persistence
  SESSION_TTL_MS: parseInt(process.env.TERMINAL_SESSION_TTL_MS || '14400000', 10), // 4 hours
  CLEANUP_EXPIRED_SESSIONS: process.env.TERMINAL_CLEANUP_EXPIRED_SESSIONS !== 'false',
  
  // Logging
  LOG_LEVEL: process.env.TERMINAL_LOG_LEVEL || 'info',
  LOG_CONNECTION_EVENTS: process.env.TERMINAL_LOG_CONNECTION_EVENTS === 'true',
  LOG_COMMAND_EXECUTION: process.env.TERMINAL_LOG_COMMAND_EXECUTION === 'true',
} as const;

export const SANDBOX_CONFIG = {
  // Provider fallback
  ENABLE_FALLBACK: process.env.SANDBOX_ENABLE_FALLBACK === 'true',
  FALLBACK_PROVIDER: process.env.SANDBOX_FALLBACK_PROVIDER || 'microsandbox',
  
  // Sprites optimization
  TAR_PIPE_THRESHOLD: parseInt(process.env.SPRITES_TAR_PIPE_THRESHOLD || '10', 10),
  
  // Timeouts
  PROVIDER_TIMEOUT_MS: 30000, // 30 seconds per provider
  MAX_RETRIES: 3,
} as const;

export const MCP_CONFIG = {
  // Security
  CLI_PORT: parseInt(process.env.MCP_CLI_PORT || '8888', 10),
  AUTH_TOKEN: process.env.MCP_AUTH_TOKEN,
  ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS || 'http://localhost:3000',
  MAX_BODY_SIZE: 1024 * 1024, // 1MB
  
  // Timeouts
  CALL_TIMEOUT_MS: parseInt(process.env.MCPORTER_CALL_TIMEOUT_MS || '30000', 10),
  LIST_TIMEOUT_MS: parseInt(process.env.MCPORTER_LIST_TIMEOUT_MS || '30000', 10),
  REFRESH_INTERVAL_MS: parseInt(process.env.MCPORTER_REFRESH_MS || '30000', 10),
  
  // Features
  ENABLED: process.env.MCPORTER_ENABLED !== 'false',
} as const;
