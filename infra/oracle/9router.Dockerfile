# 9Router server, packaged from the public npm CLI (`npm i -g 9router`).
# This wraps the same `9router` binary you have installed locally so the
# hosted instance behaves identically to your dev one.

FROM node:20-alpine

RUN apk add --no-cache tini ca-certificates

# 9router pins react/react-dom 19 — pull peer deps with --legacy-peer-deps to be safe.
RUN npm install -g --legacy-peer-deps 9router@latest

ENV PORT=3000
ENV NODE_ENV=production
ENV NINEROUTER_DATA_DIR=/data
EXPOSE 3000

VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini","--"]
# `9router serve` is the long-running mode; falls back to `9router start` for older versions.
CMD ["sh","-c","9router serve --port $PORT --data-dir $NINEROUTER_DATA_DIR || 9router start --port $PORT"]
