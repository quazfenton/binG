#Production Dockerfile for binG Backend
# Multi-stage build for optimal image size

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

# Build Next.js application
# Skip telemetry and use standalone output for Docker
ENV NEXT_TELEMETRY_DISABLED=1
# Provide minimal required env vars for build (NOT for production use!)
ENV ENCRYPTION_KEY=build-time-temporary-key-32chars!!
ENV JWT_SECRET=build-time-temporary-secret-key-for-build-only
ENV BLAXEL_SECRET_ENCRYPTION_KEY=build-time-blaxel-key-32chars!
ENV NANGO_SECRET_KEY=nango_build_temp_key
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build_temp
RUN npm run build

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
