# =============================================================================
# TimeChamp API — Production-style container
# =============================================================================
# Multi-stage build:
#   1. deps    — install ALL dependencies (incl. devDeps required by nest build)
#   2. build   — compile TypeScript → dist/, then prune devDeps
#   3. runtime — slim image with only runtime artifacts + baked env vars
#
# Build (from this directory):
#   docker build -t timechamp-api:latest .
#
# Run:
#   docker run -d --name timechamp-api -p 3001:3001 timechamp-api:latest
#
# Logs / status / stop:
#   docker logs -f timechamp-api
#   docker exec -it timechamp-api node -e "require('http').get('http://127.0.0.1:3001/health', r => r.pipe(process.stdout))"
#   docker stop timechamp-api && docker rm timechamp-api
#
# Inside the container the API runs identically to `npx nest start` on the
# host: same Node version, same compiled dist/, same env values, same port.
# =============================================================================


# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Build tools required by `bcrypt`'s node-gyp postinstall fallback when no
# prebuilt binary is available for this arch. Removed in the runtime stage,
# so the final image stays slim.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy manifest files first so Docker can cache the dependency install layer.
# `npm ci` re-runs only when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# Reproducible install from the lockfile. Faster + safer than `npm install`.
RUN npm ci


# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Bring over the fully populated node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./

# Source + tsconfig + nest config
COPY tsconfig.json nest-cli.json ./
COPY src ./src

# Compile TypeScript → dist/
RUN npx nest build

# Drop devDependencies. @nestjs/cli alone pulls in webpack + a lot of tooling
# we never need at runtime, so this cuts the runtime image significantly.
RUN npm prune --omit=dev


# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Run as a non-root user. Standard hardening — limits the blast radius if the
# Node process is ever compromised, prevents writing to /etc, prevents binding
# to ports below 1024, and is required by some k8s admission policies.
RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs --create-home nodejs

# Copy only what the runtime needs from the build stage:
#   - dist/         — compiled JavaScript
#   - node_modules/ — production-only dependencies
#   - package.json  — module resolution + Node's `type:` / `main:` lookups
COPY --from=build --chown=nodejs:nodejs /app/dist          ./dist
COPY --from=build --chown=nodejs:nodejs /app/node_modules  ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json  ./

USER nodejs

EXPOSE 3001


# ── Environment variables (BAKED INTO THE IMAGE — DEV / BETA ONLY) ───────────
#
# WARNING: every value below ends up as a layer in the image and can be
# extracted by anyone who has the image (`docker history --no-trunc` shows
# them in plain text). Acceptable for local dev and a closed beta where the
# image never leaves your machine. Before sharing the image (push to a
# registry, ship to a client, etc.) move these to runtime injection via
#   `docker run -e KEY=value ...`
# OR Docker secrets / Kubernetes secrets / AWS Secrets Manager.
#
# These values mirror apps/api/.env exactly so the container behaves
# identically to `npx nest start` on the host machine.

# Postgres / Supabase database (note the literal $ in DB_PASS must be escaped
# as \$ to prevent Dockerfile variable substitution).
ENV DATABASE_URL="postgresql://postgres.kbakbqilgilltgdlowuy:teZn8GuQ%24vw3.sc@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
ENV DB_HOST="aws-1-ap-southeast-1.pooler.supabase.com"
ENV DB_PORT="5432"
ENV DB_USER="postgres.kbakbqilgilltgdlowuy"
ENV DB_PASS="teZn8GuQ\$vw3.sc"
ENV DB_NAME="postgres"

# Auth secrets (rotate before any wider release — these are dev-only values)
ENV JWT_SECRET="timechamp-jwt-secret-key-minimum-32-characters-here"
ENV JWT_REFRESH_SECRET="timechamp-refresh-secret-32-characters-minimum-ok"
ENV JWT_EXPIRES_IN="7d"

# Supabase Storage / Auth REST endpoints
ENV SUPABASE_URL="https://kbakbqilgilltgdlowuy.supabase.co"
ENV SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiYWticWlsZ2lsbHRnZGxvd3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MzgzNzAsImV4cCI6MjA5MTMxNDM3MH0.6jyTKM_kTQm3Bc1aE1ApLArTFTHpX_T3Gro5i_sZC1Y"
ENV SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiYWticWlsZ2lsbHRnZGxvd3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTczODM3MCwiZXhwIjoyMDkxMzE0MzcwfQ.zAi_NgxQtClXXZO3_Xx3uWFSEqKQY6MfCue-Mer5BHg"

# Web dashboard URL — used as the CORS allowlist for browser requests and
# as the base URL for email links (verify / invite / reset-password).
# This is the public Azure Web App URL where the frontend container is hosted.
# No trailing slash: CORS origin matching is exact-string, and the mailer
# builds links as `${APP_URL}/verify-email?token=...`.
ENV APP_URL="https://timechamp-web-addqfkf9c7exe8da.eastasia-01.azurewebsites.net"

# Runtime knobs
ENV NODE_ENV="production"
ENV PORT="3001"


# Container-level healthcheck. Uses Node (always present) instead of curl/wget
# (which slim images don't include) to hit the API's own /health endpoint.
# Returns exit 0 = healthy, anything else = unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"


# Run as a single foreground process so:
#   - Docker captures stdout/stderr → `docker logs -f`
#   - Docker can deliver SIGTERM on `docker stop` → main.ts's SIGTERM handler
#     calls app.close() for graceful shutdown (drains in-flight requests,
#     flushes pgmq workers' final batch, closes the DB pool cleanly)
CMD ["node", "dist/main"]
