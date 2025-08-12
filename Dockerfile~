# Base image
FROM node:18-alpine AS base
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies stage
FROM base AS deps
# Install toolchain for compiling sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev
COPY package.json pnpm-lock.yaml ./
# Force sqlite3 to be built from source in Alpine
ENV npm_config_build_from_source=true
RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .


RUN pnpm run build

# Production runner stage
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/.next ./.next
EXPOSE 3000
CMD ["pnpm", "start"]
