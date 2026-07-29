FROM node:20-alpine AS builder

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime-base

WORKDIR /usr/src/app
RUN apk add --no-cache \
      font-liberation \
      font-noto \
      fontconfig \
      libreoffice \
    && fc-cache -f
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

RUN mkdir -p /usr/src/app/uploads && chown -R node:node /usr/src/app
USER node

EXPOSE 5000
ENV NODE_ENV=production

FROM runtime-base AS preview-test
USER root
RUN apk add --no-cache poppler-utils
USER node

FROM runtime-base AS runtime
CMD ["node", "src/server.js"]
