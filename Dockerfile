# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-builder

WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web ./web
# Placeholder so Vite build does not require a live catalogue; runtime serves /data.
RUN printf '[]' > web/public/products.json
RUN cd web && npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080

RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app \
  && mkdir -p /data \
  && chown -R app:app /data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scrape.mjs rank.mjs server.mjs docker-entrypoint.sh ./
COPY scripts ./scripts
COPY defaults ./defaults
COPY --from=web-builder /app/web/dist ./web/dist

RUN chmod +x /app/docker-entrypoint.sh \
  && chown -R app:app /app

USER app

VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["serve"]
