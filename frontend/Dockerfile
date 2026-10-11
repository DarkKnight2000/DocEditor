FROM node:24.16-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# No env vars needed at build time: the app reads them from $env/dynamic/*,
# which adapter-node resolves from process.env when the server starts.
# They're injected at runtime by "env_file:" in docker-compose.yml.
RUN npm run build
# CMD ["npm", "run", "preview", "--", "--port", "3000", "--host", "0.0.0.0"]


FROM node:24.16-slim

WORKDIR /app

COPY --from=builder /app/build build
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host
# ENV PORT_HEADER=x-forwarded-port

EXPOSE 3000
CMD ["node", "build"]
