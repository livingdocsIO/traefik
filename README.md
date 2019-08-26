# DroneCI Event Listener

A small service that queries a rancher v1 database for registered certificates and creates a traefik.toml configuration file with them.

This allows us to use existing rancher certificates and expose use them traefik without using letsencrypt, which would regurarely hit a rate limit when there are a lot of servers.


```bash
docker build -t marcbachmann/rancher-traefik-certificate-exporter:1.0.2 -f Dockerfile .
```

## Setup

Example docker compose that you can use in rancher:
```bash
version: '2'
services:
  loadbalancer:
    image: traefik
    volumes_from:
    - config
    ports:
    - 80:80/tcp
    - 443:443/tcp
    working_dir: /traefik-config
    command:
    - --configFile=/traefik-config/traefik.toml
    - --rancher.enableServiceHealthFilter=true
    - --rancher.exposedByDefault=false
    labels:
      io.rancher.sidekicks: config
      io.rancher.scheduler.affinity:host_label: traefik_lb=true
      io.rancher.service.external_dns_name_template: \052.%{{environment_name}}
      io.rancher.scheduler.global: 'true'
      prometheus.port: '8000'
      prometheus.job_name: traefik
  config:
    image: marcbachmann/rancher-traefik-certificate-exporter
    environment:
      MYSQL_CONNECTION_URL: mysql://username:pass@host/rancher
      DESTINATION_FILE: /traefik-config/traefik.toml
    volumes:
    - traefik-config:/traefik-config
```
