# Build từ thư mục gốc repo: docker build -f backend/Dockerfile .
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci

FROM node:20-alpine AS build
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=6510
ENV SNIPPET_DIR=/app/snippet
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
COPY snippet ./snippet
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 6510
ENTRYPOINT ["docker-entrypoint.sh"]
