# 9Router server, packaged from the public npm CLI (`npm i -g 9router`).
# This wraps the same `9router` binary you have installed locally so the
# hosted instance behaves identically to your dev one.

FROM node:20-alpine

RUN apk add --no-cache ca-certificates

# 9router pins react/react-dom 19 — pull peer deps with --legacy-peer-deps to be safe.
RUN npm install -g --legacy-peer-deps 9router@latest

ENV PORT=3000
ENV NODE_ENV=production
ENV NINEROUTER_DATA_DIR=/data
EXPOSE 3000

VOLUME ["/data"]

# 9router CLI options: -p port, -H host, -l logs
# Config is via CLI flags and env vars (NINEROUTER_ADMIN_KEY, etc.) - no config file needed
ENTRYPOINT ["9router", "-p", "3000", "-H", "0.0.0.0", "-l", "--skip-update"]
