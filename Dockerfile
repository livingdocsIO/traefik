# docker build --build-arg TAG=v1.7.21-alpine -t livingdocs/traefik:1.7.21-r0 .
# docker build --build-arg TAG=v2.1 -t livingdocs/traefik:2.1 .
ARG TAG
FROM traefik:$TAG AS traefik

FROM livingdocs/node:12.0
ARG TAG

RUN apk add --no-cache bash tzdata
COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik
WORKDIR /app

ENV TRAEFIK_VERSION=$TAG
ENV NODE_ENV=production
ADD package*.json /app/
RUN npm ci && npm cache clean --force
ADD . /app
USER root
ENTRYPOINT ["/app/entrypoint"]
