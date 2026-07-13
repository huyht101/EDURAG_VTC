FROM node:20-alpine AS builder

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

RUN mkdir -p /usr/src/app/uploads && chown -R node:node /usr/src/app
USER node

EXPOSE 5000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
