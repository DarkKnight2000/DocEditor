FROM node:24.16-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

ARG INTERNAL_JWT_SECRET
ARG SHARED_JWT_SECRET
ARG PUBLIC_GOOGLE_CLIENT_ID
ENV PUBLIC_GOOGLE_CLIENT_ID=$PUBLIC_GOOGLE_CLIENT_ID

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
