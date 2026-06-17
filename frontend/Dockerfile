# ─── Build Stage ──────────────────────────────────────────────────────────────
# NOTE: build context is the REPO ROOT (see .github/workflows + `docker build`),
# so paths below are repo-relative. The image mirrors the repo layout
# (/app/frontend + /app/shared) so the `../shared` path alias resolves the same
# in local dev and here.
FROM node:20-alpine AS builder

WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy source + the shared types package (sibling of frontend, per tsconfig paths)
COPY frontend ./
COPY shared /app/shared/

# Vite inlines VITE_* vars at build time, so the VAPID public key (needed for
# browser push subscriptions) must be present here, not at container runtime.
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

# Build the Vite app
RUN npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS production

# Copy custom nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets (built under /app/frontend)
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Create non-root user (nginx worker processes run as this user already,
# but we lock down the config files)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
