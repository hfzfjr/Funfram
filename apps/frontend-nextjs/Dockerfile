# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

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

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
