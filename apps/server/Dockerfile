# syntax=docker/dockerfile:1.7
# =============================================================================
# rate-guard server — production image (NestJS + Bun + Nx monorepo + Prisma)
#
# Build from the WORKSPACE ROOT (the monorepo needs root bun.lock/nx.json):
#   docker build -f apps/server/Dockerfile --target production -t rate-guard-server .
#
# Multi-arch release build:
#   docker buildx build -f apps/server/Dockerfile --target production \
#     --platform linux/amd64,linux/arm64 -t <registry>/rate-guard-server --push .
#
# Stages:
#   base       — pinned Bun runtime, common env
#   manifests  — lockfile + every workspace package.json (single source of truth)
#   deps       — full dev install (Nx, webpack, Prisma CLI) for building
#   builder    — prisma generate → nx prune (webpack bundle + pruned manifest)
#   prod-deps  — production-only, server-scoped, frozen install (runtime deps)
#   production — minimal non-root runtime: bun + dist + prod node_modules
#   migrate    — prisma migrate deploy job image (CLI lives here, NOT in prod)
#   dev        — optional hot-reload dev server for docker-compose --profile dev
# =============================================================================

# Pin the exact Bun patch release used to generate bun.lock locally.
# For fully reproducible builds, pin the digest instead:
#   BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:<digest>
ARG BUN_IMAGE=oven/bun:1.3.14-alpine

# ---------------------------------------------------------------- base ------
FROM ${BUN_IMAGE} AS base
WORKDIR /app
# NX_DAEMON: no long-lived daemon inside build containers.
# CI/DO_NOT_TRACK: disable interactive prompts and telemetry.
ENV NX_DAEMON=false \
    CI=true \
    DO_NOT_TRACK=1

# ----------------------------------------------------------- manifests ------
# Only lockfile + package.json files. Every install stage builds on this, so
# source edits never invalidate any `bun install` layer. Add one COPY line
# here when a new app/lib joins the workspace.
FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/server-e2e/package.json apps/server-e2e/

# ---------------------------------------------------------------- deps ------
# Full workspace dev install: Nx, webpack, TypeScript, Prisma CLI.
# The cache mount persists Bun's global package cache across builds, so even
# a lockfile change only downloads the delta.
#
# Real Node.js is added to the BUILD toolchain only: webpack-cli 7 crashes
# under Bun's runtime (CLIPlugin resolution bug), and without node in the
# image bunx transparently aliases `node` -> bun. Installs and scripts still
# go through Bun; the production stage ships no Node at all.
FROM manifests AS deps
RUN apk add --no-cache nodejs
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ------------------------------------------------------------- builder ------
FROM deps AS builder

# Prisma schema first: `prisma generate` re-runs only when the schema or the
# Prisma config changes, not on every source edit. The generated client lands
# in src/generated/prisma (gitignored + dockerignored, so the later source
# COPY cannot clobber it). DATABASE_URL is not required: generation never
# connects to a database (prisma.config.ts just reads an absent env var).
COPY apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma apps/server/prisma
RUN cd apps/server && bunx prisma generate

# Workspace config + server sources. Root tsconfigs are required because
# apps/server/tsconfig.app.json extends ../../tsconfig.base.json.
COPY nx.json tsconfig.json tsconfig.base.json ./
COPY apps/server/ apps/server/

# `prune` = build (webpack, NODE_ENV=production) + prune-lockfile +
# copy-workspace-modules. Output in apps/server/dist:
#   main.js (+ .map), assets, package.json (production manifest),
#   workspace_modules/ (built workspace libs, when they exist).
# The cache mount keeps Nx's computation cache across image rebuilds.
RUN --mount=type=cache,target=/app/.nx/cache \
    bunx nx run @rate-guard/server:prune --verbose

# ----------------------------------------------------------- prod-deps ------
# Runtime dependencies only, resolved from the SAME root bun.lock that built
# the app (reproducible), scoped to the server workspace (--filter: no
# Next.js/React/Prisma CLI), production only (no dev deps), hoisted linker
# (flat, symlink-free node_modules that can be copied between stages).
FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile \
        --filter '@rate-guard/server' --linker hoisted \
 && rm -rf node_modules/@rate-guard apps/*/node_modules

# ---------------------------------------------------------- production ------
FROM ${BUN_IMAGE} AS production

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# App files stay root-owned and world-readable; the process runs as the
# unprivileged `bun` user shipped with the base image and cannot modify its
# own code — safe for `docker run --read-only`.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/apps/server/dist/ ./

USER bun

EXPOSE 3000

# Exec-form healthcheck (no shell in the hot path); hits the global prefix.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["bun", "main.js"]

# ------------------------------------------------------------- migrate ------
# Separate job image for `prisma migrate deploy` so the Prisma CLI (schema
# engine & friends) never ships in the production image. Run it as a one-off
# job / init container / compose service before rolling the server.
FROM manifests AS migrate
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter '@rate-guard/server' --linker hoisted
COPY apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma apps/server/prisma
WORKDIR /app/apps/server
ENV NODE_ENV=production
USER bun
CMD ["bunx", "prisma", "migrate", "deploy"]

# ----------------------------------------------------------------- dev ------
# Optional containerized dev server (docker-compose --profile dev). For
# day-to-day work, running `bunx nx serve @rate-guard/server` natively is
# faster — especially on Windows/macOS where bind mounts are slow.
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "cd apps/server && bunx prisma generate && cd /app && bunx nx serve @rate-guard/server"]
