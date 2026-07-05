# syntax=docker/dockerfile:1.7
# =============================================================================
# rate-guard dashboard — production image (Next.js standalone + Bun + Nx)
#
# Build from the WORKSPACE ROOT (the monorepo needs root bun.lock/nx.json):
#   docker build -f apps/client/Dockerfile --target production -t rate-guard-client .
#
# BuildKit uses apps/client/Dockerfile.dockerignore for this build (the root
# .dockerignore is tuned for the server image and excludes client sources).
#
# Stages:
#   base       — pinned Bun runtime, common env
#   manifests  — lockfile + every workspace package.json
#   deps       — full dev install (Nx, Next) for building
#   build      — next build (standalone output, traced from workspace root)
#   production — minimal non-root Node runtime for the standalone server
# =============================================================================

ARG BUN_IMAGE=oven/bun:1.3.14-alpine
ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------- base ------
FROM ${BUN_IMAGE} AS base
WORKDIR /app
ENV NX_DAEMON=false \
    CI=true \
    DO_NOT_TRACK=1 \
    NEXT_TELEMETRY_DISABLED=1

# ----------------------------------------------------------- manifests ------
FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/server-e2e/package.json apps/server-e2e/

# ---------------------------------------------------------------- deps ------
# Real Node.js joins the build toolchain: the Next.js compiler expects a node
# runtime (same reasoning as webpack in the server image).
FROM manifests AS deps
RUN apk add --no-cache nodejs
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# --------------------------------------------------------------- build ------
FROM deps AS build
COPY nx.json tsconfig.json tsconfig.base.json ./
COPY apps/client/ apps/client/
RUN --mount=type=cache,target=/app/.nx/cache \
    bunx nx build @rate-guard/client --verbose

# ---------------------------------------------------------- production ------
# Plain Node runtime: the standalone output is a self-contained node server.
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Standalone bundle mirrors the workspace layout: server.js lives under
# apps/client/. Static assets and public/ are served from disk and are not
# part of the traced output, so they are copied alongside.
COPY --from=build /app/apps/client/.next/standalone ./
COPY --from=build /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=build /app/apps/client/public ./apps/client/public

# Next writes runtime caches under .next/cache — the only path that needs to
# be writable by the unprivileged user.
RUN mkdir -p apps/client/.next/cache && chown -R node:node apps/client/.next/cache

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "apps/client/server.js"]
