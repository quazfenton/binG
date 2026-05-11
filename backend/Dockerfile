FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Copy necessary workspace folders
COPY web/package.json ./web/package.json
COPY backend/package.json ./backend/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the backend
RUN pnpm --filter backend build

EXPOSE 3001
CMD [ "pnpm", "--filter", "backend", "start" ]
