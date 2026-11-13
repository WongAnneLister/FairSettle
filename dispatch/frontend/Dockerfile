FROM node:20.19.5-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20.19.5-bookworm-slim AS build
WORKDIR /app
ARG BACKEND_GRAPHQL_URL=http://dispatch:4000/graphql
ARG BACKEND_UPLOADS_URL=http://dispatch:4000/uploads
# Browser-side URLs, inlined at build time; empty keeps the code's localhost defaults (deploy/ sets them).
ARG NEXT_PUBLIC_COMPLAINT_PAGE_URL=
ARG NEXT_PUBLIC_WS_GRAPHQL_ENDPOINT=
ENV NEXT_TELEMETRY_DISABLED=1 \
    BACKEND_GRAPHQL_URL=${BACKEND_GRAPHQL_URL} \
    BACKEND_UPLOADS_URL=${BACKEND_UPLOADS_URL} \
    NEXT_PUBLIC_COMPLAINT_PAGE_URL=${NEXT_PUBLIC_COMPLAINT_PAGE_URL} \
    NEXT_PUBLIC_WS_GRAPHQL_ENDPOINT=${NEXT_PUBLIC_WS_GRAPHQL_ENDPOINT}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20.19.5-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3001
CMD ["node", "server.js"]
