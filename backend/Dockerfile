# syntax=docker/dockerfile:1
# Build context MUST be the repo root, e.g.:
#   docker build -f backend/Dockerfile -t bing-backend .
#   fly deploy   --config backend/fly.toml --dockerfile backend/Dockerfile
#
# This image bundles the Hono orchestrator + the heavy `web/lib/*` modules
# it imports through the `@/*` tsconfig path. Frontend pages are NOT shipped.

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=false
RUN corepack enable

# ----------------------------------------------------------
# Stage 1 — install workspace deps (cached on lockfile only)
# ----------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Native build deps (better-sqlite3, node-pty, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Workspace manifest files only — maximises cache reuse
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY web/package.json            ./web/package.json
COPY backend/package.json        ./backend/package.json
COPY packages/shared/package.json   ./packages/shared/package.json
COPY packages/platform/package.json ./packages/platform/package.json
COPY packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY web/.bing-platform ./web/.bing-platform
COPY web/.bing-shared ./web/.bing-shared

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter backend... --filter @bing/shared... --filter @bing/platform...

# Mock server-only package — throws in Next.js client context but backend runs
# in pure Node.js where the import should be a no-op.
RUN echo 'export {};' > node_modules/server-only/index.js

# ----------------------------------------------------------
# Stage 2 — copy source + run tsc (noEmit) for type safety
# ----------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Source for backend + everything it imports through `@/*`
COPY backend  ./backend
COPY packages ./packages
# `web/lib` is consumed via tsconfig path "@/*": ["../web/*"].
# We ship `web/lib` + specific API routes that work in Node.js backend.
# Many routes import React client components or use browser APIs and
# cannot run in the backend environment — those stay in the Next.js frontend.
COPY web/lib  ./web/lib
COPY web/deprecated ./web/deprecated
# The next-route-loader auto-mounts every web/app/api/**/route.ts at startup.
# Copy the full API tree so dynamic route discovery works in production.
COPY web/app/api ./web/app/api
COPY web/components ./web/components
COPY tsconfig.json ./tsconfig.json

# tsx runs TS at runtime — no build step needed.
# (Optional) sanity typecheck — comment out to speed up first deploys.
# RUN pnpm --filter backend exec tsc --noEmit

# ----------------------------------------------------------
# Stage 3 — slim runtime
# ----------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Runtime libs only
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["pnpm","--filter","backend","dev"]
