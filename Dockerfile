#Production Dockerfile for binG Backend
# Multi-stage build for optimal image size
#
# SECURITY: This Dockerfile uses BuildKit --secret mounts for sensitive data.
# Secrets are NEVER passed via ARG/ENV as they would leak through build cache.
#
# Build with secrets (requires DOCKER_BUILDKIT=1):
#   DOCKER_BUILDKIT=1 docker build \
#     --secret id=encryption_key,env=ENCRYPTION_KEY \
#     --secret id=jwt_secret,env=JWT_SECRET \
#     --secret id=blaxel_encryption_key,env=BLAXEL_SECRET_ENCRYPTION_KEY \
#     --secret id=nango_secret_key,env=NANGO_SECRET_KEY \
#     --secret id=database_url,env=DATABASE_URL \
#     -t bing-backend .
#
# Or from .env file:
#   DOCKER_BUILDKIT=1 docker build \
#     --secret id=encryption_key,src=.env.encryption_key \
#     ... \
#     -t bing-backend .
# ===========================================

# ===========================================
# Stage 1: Dependencies
# ===========================================

# Base image - Alpine for consistency across all stages
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
# Using npm install instead of ci to resolve peer dependency conflicts dynamically
# Install ALL dependencies (including dev) for build step
RUN npm install --legacy-peer-deps && npm cache clean --force

# ===========================================
# Stage 2: Builder
# ===========================================
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Build-time arguments for required environment variables
# SECURITY: Using BuildKit --secret mounts instead of ARG/ENV to prevent secret leakage
# Secrets are mounted at /run/secrets/<secret_name> during build only
# They do NOT appear in build cache, intermediate layers, or final image
# Usage: docker build --secret id=encryption_key,env=ENCRYPTION_KEY ...

# Build Next.js application
# Skip telemetry and use standalone output for Docker
ENV NEXT_TELEMETRY_DISABLED=1

# Use BuildKit secrets for build-time secret access
# Secrets are accessed via /run/secrets/<secret_name> and never stored in image
RUN --mount=type=secret,id=encryption_key \
    --mount=type=secret,id=jwt_secret \
    --mount=type=secret,id=blaxel_encryption_key \
    --mount=type=secret,id=nango_secret_key \
    --mount=type=secret,id=database_url \
    export ENCRYPTION_KEY=$(cat /run/secrets/encryption_key) && \
    export JWT_SECRET=$(cat /run/secrets/jwt_secret) && \
    export BLAXEL_SECRET_ENCRYPTION_KEY=$(cat /run/secrets/blaxel_encryption_key) && \
    export NANGO_SECRET_KEY=$(cat /run/secrets/nango_secret_key) && \
    export DATABASE_URL=$(cat /run/secrets/database_url) && \
    npm run build

# ===========================================
# Stage 3: Runner
# ===========================================
FROM node:20-alpine AS runner

RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    curl \
    jq

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create necessary directories
RUN mkdir -p /tmp/workspaces /tmp/snapshots /tmp/firecracker
RUN chown -R nextjs:nodejs /tmp/workspaces /tmp/snapshots /tmp/firecracker

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy backend initialization script
COPY --from=builder --chown=nextjs:nodejs /app/scripts/init-backend.js ./scripts/

# Switch to non-root user
USER nextjs

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/backend/health || exit 1

# Set environment variables
ENV PORT=3000
ENV STORAGE_TYPE=local
ENV LOCAL_SNAPSHOT_DIR=/tmp/snapshots
ENV WORKSPACE_DIR=/tmp/workspaces
ENV RUNTIME_TYPE=process

# Start application
# Note: WebSocket server runs on same port as HTTP (port 3000)
# WebSocket connections upgrade from HTTP at ws://localhost:3000
CMD ["node", "server.js"]
