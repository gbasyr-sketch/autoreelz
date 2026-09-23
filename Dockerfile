FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1

# npm is pinned inside the build image; the host installation is untouched.
FROM base AS npm-base
RUN npm install --global npm@11.19.1 --no-audit --no-fund
COPY package.json package-lock.json ./

FROM npm-base AS build
RUN npm ci --include=dev --no-audit --no-fund
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM npm-base AS production-dependencies
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
ARG VCS_REF=development
RUN node -e "if(!/^(development|[a-f0-9]{40})$/.test(process.argv[1]))process.exit(1)" "$VCS_REF"
LABEL org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    APP_REVISION=$VCS_REF
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node scripts/commerce-worker.ts ./scripts/commerce-worker.ts
COPY --chown=node:node package.json ./
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4321') + '/health', { signal: AbortSignal.timeout(4000), redirect: 'manual' }).then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "./dist/server/entry.mjs"]
