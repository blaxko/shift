# SHIFT executor (crank). Build from the REPO ROOT:  docker build -f crank/Dockerfile -t shift-crank .
# DRY-RUN BY DEFAULT: with no env changes this image only simulates, never sends, and needs no secret key.
FROM node:22-alpine
WORKDIR /app

# npm workspaces: the lockfile references every workspace, so each package.json must exist (app/ is not otherwise needed).
COPY package.json package-lock.json tsconfig.base.json ./
COPY app/package.json app/package.json
COPY packages/codec packages/codec
COPY crank crank

# Install only what the crank needs (+ tsx, a root devDependency, to run TypeScript directly).
RUN npm ci --workspace=crank --workspace=packages/codec --include-workspace-root --include=dev --ignore-scripts --no-audit --no-fund

ENV DRY_RUN=1 \
    PORT=8080
EXPOSE 8080
USER node
CMD ["npx", "tsx", "crank/src/index.ts"]
