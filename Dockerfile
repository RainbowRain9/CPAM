FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7940

# better-sqlite3 在 Debian 系镜像上更稳；只装运行期依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/db.js ./db.js

RUN mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 7940

CMD ["node", "server.js"]
