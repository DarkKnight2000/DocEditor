FROM node:24.16-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Needed at build time: the app imports these from $env/static/private and
# $env/static/public, which Vite inlines into the bundle during "npm run build".
# Values come from compose build args, which docker-compose.yml fills from the
# Makefile's --env-file frontend/.env (.env files are excluded by .dockerignore).
# ARGs are exposed as env vars to RUN steps, so the build sees them.
# Note: the inlined values end up in /app/build of the final image, and changing
# them requires a rebuild; the runtime env_file doesn't override them.
ARG INTERNAL_JWT_SECRET
ARG SHARED_JWT_SECRET
ARG PUBLIC_GOOGLE_CLIENT_ID

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
