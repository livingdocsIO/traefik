FROM traefik:v1.7.21-alpine AS traefik

FROM livingdocs/node:12.0
RUN apk add --no-cache bash
COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik
WORKDIR /app

ENV NODE_ENV production
ADD package*.json /app/
RUN npm ci && npm cache clean --force
ADD . /app
USER root
ENTRYPOINT ["/app/entrypoint"]
