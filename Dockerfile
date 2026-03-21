FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-build
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist /app/client/dist

RUN mkdir -p /app/data/users/adi/sessions && \
    echo '{"id":"adi","name":"Adi","learningFocus":"placeholder","timezone":"Asia/Kolkata","notes":"Initial placeholder profile."}' \
    > /app/data/users/adi/profile.json

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
