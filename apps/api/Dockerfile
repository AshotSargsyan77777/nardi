# Base image from the AWS ECR mirror of Docker Official Images (avoids Docker Hub pull rate limits)
# Build context: repository root  (docker build -f apps/api/Dockerfile .)
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @nardi/engine --workspace @nardi/api --include-workspace-root --no-audit --no-fund

FROM deps AS build
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN npm run build -w @nardi/engine \
 && cd apps/api && npx prisma generate && npx nest build

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/scripts ./apps/api/scripts
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrations + seed (+ optional admin bootstrap) run on every start; all steps are idempotent
CMD ["sh", "-c", "sh scripts/predeploy.sh && exec node dist/main.js"]
