# docker build --build-arg TAG=v1.7.24-alpine -t livingdocs/traefik:1.7.24 .
# docker build --build-arg TAG=v2.2.1 -t livingdocs/traefik:2.2.1 .
ARG TAG
FROM traefik:$TAG AS traefik

FROM livingdocs/node:12.0
ARG TAG

COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik
WORKDIR /app

ENV TRAEFIK_VERSION=$TAG NODE_ENV=production
ADD package*.json /app/
RUN apk add --no-cache bash tzdata && npm ci && npm cache clean --force
ADD . /app
USER root
ENTRYPOINT ["/app/entrypoint"]
