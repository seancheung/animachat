# syntax=docker/dockerfile:1.7

# === Stage 1: install dependencies ===========================================
# Isolated so the slow `npm ci` only re-runs when the lockfile changes.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# === Stage 2: build app ======================================================
FROM node:22-alpine AS builder
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs ./
COPY public ./public
COPY src ./src

ENV NEXT_TELEMETRY_DISABLED=1 STANDALONE_OUTPUT=1
RUN npm run build

# === Stage 3: runtime ========================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# stateless container — the database lives in Postgres (DATABASE_URL) and
# uploaded assets in the S3/MinIO bucket (S3_* vars)
EXPOSE 3000

CMD ["node", "server.js"]
