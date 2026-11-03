# Base image from the AWS ECR mirror of Docker Official Images (avoids Docker Hub pull rate limits)
# Build context: repository root  (docker build -f apps/web/Dockerfile .)
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @nardi/engine --workspace @nardi/web --include-workspace-root --no-audit --no-fund

FROM deps AS build
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_WS_URL=
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} NEXT_TELEMETRY_DISABLED=1
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN npm run build -w @nardi/engine && npm run build -w @nardi/web

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# platforms may inject their own HOSTNAME; always bind all interfaces
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/web/server.js"]
