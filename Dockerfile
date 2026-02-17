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

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=node:node /app/components ./components
COPY --from=builder --chown=node:node /app/app ./app

# Create data directory for database and set ownership
RUN mkdir -p /app/data && chown -R node:node /app/data

# Switch to non-root user for security
USER node

EXPOSE 3000
CMD ["pnpm", "start"]
