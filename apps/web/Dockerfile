# syntax=docker/dockerfile:1
FROM node:22.21-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @qtm/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @qtm/shared build && pnpm --filter @qtm/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
