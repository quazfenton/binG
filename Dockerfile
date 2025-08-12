# Base image
FROM node:18-alpine AS base
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

# Builder stage
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# Production runner stage
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/.next ./.next
EXPOSE 3000
CMD ["pnpm", "start"]
