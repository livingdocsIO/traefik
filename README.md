# Traefik

A small docker image with https://github.com/containous/traefik that includes a nodejs script that fetches certificates from a remote server.

This allows us to use and manage existing certificates without any dependencies except s3 as storage.
We're still running some databases outside of rancher/kubernetes and therefore we'll need the separate letsencrypt storage anyways.

```bash
docker build -t livingdocs/traefik:1 -f Dockerfile .
```

## Setup

```bash
# First start a letsencrypt service that pushes certificates to S3
# See https://github.com/livingdocsIO/docker/tree/master/letsencrypt

# then run this with a token generated in the letsencrypt service
docker run \
  -e DESTINATION_FILE=/etc/traefik.toml \
  -e CERTIFICATE_URL=https://certificates.example.com \
  -e CERTIFICATE_URL_TOKEN=someJsonWebTokenOrBearerToken
  livingdocs/traefik:1 \
    --configFile=/etc/traefik.toml \
    --rancher.enableServiceHealthFilter=true \
    --rancher.exposedByDefault=false
```
