FROM node:10-alpine
WORKDIR /app

ADD . /app
RUN npm install && npm cache clean --force && npm uninstall -g npm
USER root
CMD ["node", "/app/index.js"]
