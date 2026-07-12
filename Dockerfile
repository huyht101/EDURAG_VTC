# Stage 1: Build & Cài đặt dependencies
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

# Stage 2: Runtime Production
FROM node:20-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

# Đảm bảo phân quyền không chạy bằng root user để tăng tính bảo mật
USER node

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
