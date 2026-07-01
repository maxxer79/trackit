# ─── Build Stage ──────────────────────────────────────────────────────────────
# NOTE: build context is the REPO ROOT (see .github/workflows + `docker build`),
# so paths below are repo-relative. The image mirrors the repo layout
# (/app/backend + /app/shared) so the `../shared` path alias resolves the same
# in local dev and here.
FROM node:20-alpine AS builder

WORKDIR /app/backend

# Install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy source + the shared types package (sibling of backend, per tsconfig paths)
COPY backend/tsconfig.json ./
COPY backend/prisma ./prisma/
COPY backend/src ./src/
COPY shared /app/shared/

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript (shared/*.d.ts is type-only — erased, not emitted to dist)
RUN npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL for Prisma + Chromium for headless browser scraping +
# postgresql-client (pg_dump/pg_restore/psql) for the DB backup/restore feature.
# Pinned to the v15 client to match the postgres:15 server.
RUN apk add --no-cache \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    postgresql15-client

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install only production deps
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copy compiled output and Prisma client (built under /app/backend)
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/backend/node_modules/@prisma ./node_modules/@prisma
COPY backend/prisma ./prisma/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S trackit -u 1001 -G nodejs && \
    chown -R trackit:nodejs /app

USER trackit

EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
