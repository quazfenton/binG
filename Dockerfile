# Base image - Using debian instead of alpine for better compatibility with native modules
FROM node:18-bullseye AS base
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y python3 make g++ build-essential

# Builder stage
FROM base AS builder
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Rebuild native modules for the Linux environment
RUN pnpm rebuild better-sqlite3

# Build the application
RUN SKIP_DB_INIT=1 pnpm run build

# Production runner stage
FROM base AS runner
ENV NODE_ENV=production

# Install build dependencies in the production image to ensure native modules work
RUN apt-get update && apt-get install -y python3 make g++ build-essential

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/data ./data
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/components ./components
COPY --from=builder /app/app ./app

# Rebuild native modules in the production image as well to ensure they're compatible
RUN pnpm rebuild better-sqlite3

EXPOSE 3000
CMD ["pnpm", "start"]
