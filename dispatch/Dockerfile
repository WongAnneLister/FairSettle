# Build with the full Node image: native modules can use python3, make, and g++.
FROM node:22-bookworm AS build
WORKDIR /build

# Install the locked dependency tree before copying source to preserve layer caching.
COPY package.json package-lock.json ./
RUN HUSKY=0 npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src src
RUN npm run build && npm prune --omit=dev

# Keep production dependencies and compiled assets in the runtime image.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /build/package.json ./
COPY --from=build --chown=node:node /build/node_modules ./node_modules
COPY --from=build --chown=node:node /build/dist ./dist

USER node
EXPOSE 4000

# Production migrations finish before the API starts.
CMD ["sh", "-c", "node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js && node dist/main"]
