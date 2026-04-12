# =============================================================================
# TimeChamp Web — Production-style container (Next.js 14 standalone)
# =============================================================================
# Multi-stage build:
#   1. deps    — install ALL dependencies (incl. devDeps required by next build)
#   2. build   — run `next build` (standalone output), bake in NEXT_PUBLIC_* vars
#   3. runtime — slim image with only .next/standalone/ + .next/static/
#
# Build (from this directory):
#   docker build -t timechamp-web:latest .
#
# Run:
#   docker run -d --name timechamp-web -p 3000:3000 timechamp-web:latest
#
# Logs / status / stop:
#   docker logs -f timechamp-web
#   docker stop timechamp-web && docker rm timechamp-web
#
# The resulting container starts with `node server.js` on port 3000,
# identical to how `pnpm dev:web` behaves on the host.
# =============================================================================


# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Copy manifest files first so Docker caches the dependency install layer.
# `npm ci` re-runs only when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# Reproducible install from the lockfile.
RUN npm ci


# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Bring over the fully populated node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./

# Source + Next.js / TS / Tailwind config
COPY next.config.js next-env.d.ts tsconfig.json tailwind.config.ts postcss.config.js middleware.ts ./
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY stores ./stores
COPY types ./types

# Public assets — the folder doesn't exist in the repo, so create an
# empty stub just so the COPY in the runtime stage always has a source.
RUN mkdir -p ./public

# ── BAKED ENV (BUILD-TIME) ───────────────────────────────────────────────────
# `NEXT_PUBLIC_*` variables are inlined into the client-side JavaScript
# bundles by `next build`. They must be present during the build, not
# just at runtime. That's why we set them here as ENV (not ARG — ENV
# is more explicit and survives multi-line COPY invalidation).
#
# If you need to rebuild pointing at a different API, change this
# value or pass --build-arg at docker build time after refactoring
# to ARG + ENV pattern.
ENV NEXT_PUBLIC_API_URL="https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1"

# Optional: Next.js telemetry off during build for slightly faster builds
# and to avoid any outbound calls during CI.
ENV NEXT_TELEMETRY_DISABLED=1

# Compile → .next/ + .next/standalone/ + .next/static/
RUN npx next build


# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Non-root user — standard hardening.
RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs --create-home nextjs

# Next.js's standalone output ships a self-contained server.js plus a
# trimmed node_modules folder under .next/standalone/. We copy only
# what's needed:
#   - .next/standalone/  → server.js + runtime node_modules
#   - .next/static/      → client JS/CSS bundles served at /_next/static
#   - public/            → static assets (empty stub if none)
#
# Note the `.` at the end of the first COPY — it flattens
# `.next/standalone/*` directly into /app, so server.js lives at /app/server.js.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static      ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public            ./public

USER nextjs

EXPOSE 3000


# ── Environment variables (BAKED INTO THE IMAGE — DEV / BETA ONLY) ───────────
#
# WARNING: every value below ends up as a layer in the image and can be
# extracted by anyone who has the image (`docker history --no-trunc` shows
# them in plain text). Acceptable for local dev and a closed beta where
# the image never leaves your machine. Before sharing the image (push to
# a registry, ship to a client, etc.) move these to runtime injection
# via `docker run -e KEY=value ...` OR Docker / Kubernetes secrets.
#
# These mirror apps/web/.env.local so the container behaves identically
# to `next dev` / `next start` on the host.

# NextAuth — the secret signs JWT session cookies. The URL is the
# canonical public URL of THIS web app (the one the browser reaches).
# If you deploy the container behind a public domain, OVERRIDE
# NEXTAUTH_URL at `docker run -e NEXTAUTH_URL=https://app.example.com`
# — otherwise sign-in callbacks will redirect to localhost and break.
ENV NEXTAUTH_URL="https://timechamp-web-addqfkf9c7exe8da.eastasia-01.azurewebsites.net"
ENV NEXTAUTH_SECRET="timechamp-nextauth-secret-minimum-32-characters-here"

# Server-side NextAuth calls (refresh-token flow, credentials login
# handler) use this URL. Points at the Azure API, same as the client.
ENV API_URL="https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1"

# Also set NEXT_PUBLIC_API_URL at runtime so server components that
# read process.env.NEXT_PUBLIC_API_URL (outside of the inlined client
# bundles) resolve correctly. Redundant with the build-time ENV, but
# cheap and prevents a class of "undefined" surprises.
ENV NEXT_PUBLIC_API_URL="https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1"

# Runtime knobs
ENV NODE_ENV="production"
ENV PORT="3000"
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1


# Container-level healthcheck. Uses Node (always present) instead of
# curl/wget (absent on slim images) to hit the Next.js root. Next.js
# returns 200 or 307 (redirect to /login) — both count as "up".
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"


# Run as a single foreground process so Docker captures stdout/stderr
# for `docker logs -f` and can deliver SIGTERM on `docker stop` for
# graceful shutdown.
CMD ["node", "server.js"]
