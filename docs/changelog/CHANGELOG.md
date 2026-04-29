# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Auth Service**: Added LRU eviction to `failedLoginAttempts` Map with max 10,000 entries to prevent memory exhaustion DoS via unique email enumeration. Added `evictOldestIfNeeded()` function and `entryCount` tracking. (`lib/auth/auth-service.ts`)

- **Proxy Route**: Fixed `isPrivateIP()` function to use proper CIDR range checking instead of string prefix matching. Now correctly identifies 172.16.0.0/12 private range using numeric comparison (`b >= 16 && b <= 31`) to avoid any potential false positives with public IP ranges like 172.160.x.x. (`app/api/proxy/route.ts`)

### Engineering

- **LLM Providers**: Circuit breaker is wired in `enhanced-llm-service.ts` for provider-specific failure handling. The main `llm-providers.ts` delegates to the enhanced service when `enableCircuitBreaker` is enabled.