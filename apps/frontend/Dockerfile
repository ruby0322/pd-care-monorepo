FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

ARG NEXT_PUBLIC_LIFF_ID=
ENV NEXT_PUBLIC_LIFF_ID=${NEXT_PUBLIC_LIFF_ID}

RUN npm run build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY tls-gateway.cjs ./tls-gateway.cjs

EXPOSE 3000 443

CMD ["sh", "-c", "npm run start -- --hostname 127.0.0.1 --port 3000 & exec node tls-gateway.cjs"]
