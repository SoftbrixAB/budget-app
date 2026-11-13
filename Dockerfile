FROM node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY budget.js ./
COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    NODE_ENV=production

RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
