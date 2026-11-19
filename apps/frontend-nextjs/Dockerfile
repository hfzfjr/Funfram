# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_WS_GAME_URL
ARG NEXT_PUBLIC_WS_WEBRTC_URL
ARG NEXT_PUBLIC_APP_URL

ENV NEXT_PUBLIC_WS_GAME_URL=$NEXT_PUBLIC_WS_GAME_URL
ENV NEXT_PUBLIC_WS_WEBRTC_URL=$NEXT_PUBLIC_WS_WEBRTC_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN npm run build

# Production stage
FROM node:20-alpine AS runner

RUN apk add --no-cache wget \
    && addgroup -S nodejs && adduser -S nextjs -G nodejs

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
