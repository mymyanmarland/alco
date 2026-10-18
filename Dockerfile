# ── ALCO OS production image (M6-A) ──────────────────────────────────
# Multi-stage: deps → builder → runner. Next.js standalone output.
# Build:   docker build -t alco-os:<tag> .
# Migrate: docker run --rm --env-file .env alco-os:<tag> npx prisma migrate deploy
#          (prisma CLI + schema are included; see DEPLOY.md)
# Run:     docker run -d --name alco-os --env-file .env \
#            -p 127.0.0.1:3101:3000 -v alco-storage:/app/storage alco-os:<tag>

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma engines download here (works on normal networks; the sandbox-only
# CDN workaround from M2/M3/M5 is NOT needed on the VPS).
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# git is required at runtime by the builder's git-backed project storage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Prisma generated client + query engine (not always traced by standalone).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Prisma CLI + schema for one-off `migrate deploy` runs.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Writable project storage (one git repo per project).
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage /app/public
VOLUME ["/app/storage"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
