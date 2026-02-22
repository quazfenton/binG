# Base image - Using debian instead of alpine for better compatibility with native modules
FROM node:20-bullseye AS base
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

# Builder stage
FROM base AS builder
# Install build dependencies for native modules
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ build-essential \
  && rm -rf /var/lib/apt/lists/*
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Rebuild native modules for the Linux environment
RUN pnpm rebuild better-sqlite3

# Build the application
RUN SKIP_DB_INIT=1 pnpm run build

# Prune devDependencies for production
RUN pnpm prune --prod

# Production runner stage
FROM base AS runner
ENV NODE_ENV=production

# Copy only runtime essentials - Next.js standalone mode bundles everything needed
COPY --from=builder --chown=root:root /app/node_modules ./node_modules
COPY --from=builder --chown=root:root /app/package.json ./package.json
COPY --from=builder --chown=root:root /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=root:root /app/.next ./.next
COPY --from=builder --chown=root:root /app/public ./public
COPY --from=builder --chown=root:root /app/next.config.mjs ./next.config.mjs

# Set restrictive permissions on application files (read-only for non-root users)
RUN chmod -R 755 /app/node_modules /app/public \
    && chmod 644 /app/package.json /app/pnpm-lock.yaml /app/next.config.mjs \
    && chmod -R 755 /app/.next

# Create writable directories for runtime data
RUN mkdir -p /app/data /app/.next/cache \
    && chown -R node:node /app/data /app/.next/cache \
    && chmod -R 755 /app/data /app/.next/cache

# Switch to non-root user for security
USER node

EXPOSE 3000
CMD ["pnpm", "start"]
