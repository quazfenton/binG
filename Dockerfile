# Use an official Node.js runtime as the base image
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install dependencies
RUN pnpm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Next.js app
RUN pnpm run build

# Production image, copy only the necessary artifacts
FROM base AS runner
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy only the necessary files for the standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Expose the port the app runs on (default for Next.js is 3000)
EXPOSE 3000

# Start the Next.js app
CMD ["node", "server.js"]
