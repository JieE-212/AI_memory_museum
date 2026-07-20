# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS checks
WORKDIR /app
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0
WORKDIR /app
COPY --from=checks /app/package.json ./package.json
COPY --from=checks /app/server.js ./server.js
COPY --from=checks /app/database.js ./database.js
COPY --from=checks /app/lib ./lib
COPY --from=checks /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
