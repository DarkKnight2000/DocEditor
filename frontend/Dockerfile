FROM node:24.16-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# exactly the versions in package-lock.json
RUN npm ci

COPY . .

# No env vars needed at build time: the app reads them from $env/dynamic/*,
# which adapter-node resolves from process.env when the server starts.
# They're injected at runtime by "env_file:" in docker-compose.yml.
RUN npm run build
# CMD ["npm", "run", "preview", "--", "--port", "3000", "--host", "0.0.0.0"]


FROM node:24.16-slim

WORKDIR /app

# The build bundles everything from devDependencies (Svelte, Quill, the icons...), so the server only
# needs the few runtime dependencies; installing just those keeps the image small to push and pull.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /app/build build

ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host
# ENV PORT_HEADER=x-forwarded-port

EXPOSE 3000
CMD ["node", "build"]
