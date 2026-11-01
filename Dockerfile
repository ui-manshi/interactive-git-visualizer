# ---- 1. install dependencies ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. build the app (standalone output = small runtime image) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 STANDALONE=1
RUN npm run build

# ---- 3. runtime ----
FROM node:20-bookworm-slim AS runner
# git is needed for exactly one thing: cloning/fetching the GitHub repositories people open.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=10000 \
    ALLOW_LOCAL_PATHS=false \
    CLONE_CACHE_DIR=/data/clones \
    MAX_REPO_MB=200 \
    MAX_CACHED_REPOS=15 \
    MAX_CONCURRENT_CLONES=2

# Run as an unprivileged user that can only write to the clone cache.
RUN useradd --create-home --uid 1001 app \
 && mkdir -p /data/clones \
 && chown -R app:app /data

WORKDIR /app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

USER app
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
