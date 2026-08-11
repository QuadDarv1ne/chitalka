FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY prisma ./prisma
ENV DATABASE_URL=file:/data/chitalka.db
# Lockfile was generated on Windows — all native modules (lightningcss, sharp)
# resolved to Windows binaries. Delete it and let npm resolve fresh for musl.
RUN rm -f package-lock.json && npm install --no-audit --no-fund && npm cache clean --force

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV JWT_SECRET=real-secret-please-configure-via-env-vars-in-amvera-2026
RUN npm run build

FROM base AS runner
RUN apk add --no-cache wget && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs && mkdir -p /data && chown nextjs:nodejs /data
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV JWT_SECRET=real-secret-please-configure-via-env-vars-in-amvera-2026
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=file:/data/chitalka.db
COPY package.json ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY prisma ./prisma
# Same fix for runtime — no lockfile, npm resolves for musl
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && node server.js"]