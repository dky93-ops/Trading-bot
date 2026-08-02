# Multi-stage Dockerfile for Koyeb & Cloud deployment

# Stage 1: Builder Phase
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package specifications and lockfile
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy full source code
COPY . .

# Build application (Vite frontend + esbuild bundled backend)
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Production Execution Phase
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Koyeb assigns PORT dynamically (defaults to 8000 or 3000)
ENV PORT=8000

# Copy package specifications and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled dist bundle from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${PORT:-8000}/api/health || exit 1

# Start server directly via compiled bundle
CMD ["node", "dist/server.cjs"]

