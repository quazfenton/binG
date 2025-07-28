# Base stage
FROM node:18-alpine AS base

# Deps stage
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install -g pnpm
RUN pnpm install

# Builder stage
FROM base AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm run build

# Production stage
FROM node:18-alpine AS runner
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

RUN npm install -g pnpm
EXPOSE 3000
CMD ["pnpm", "start"]
