# 9Router Multi-Tenant Fork - Docker Image
# Base image with Node.js 20 LTS
FROM node:20-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only - omit devDependencies)
RUN npm ci --omit=dev

# Copy application code
COPY --chown=nextjs:nodejs src/ ./src/
COPY --chown=nextjs:nodejs prisma/ ./prisma/
COPY --chown=nextjs:nodejs .env.example .env

# Create data directory with proper ownership
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

# Expose the default port
EXPOSE 20128

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:20128/api/health || exit 1

# Switch to non-root user
USER nextjs

# Run the application
CMD [node, src/index.js]