# 9Router server, packaged from the public npm CLI (`npm i -g 9router`).
# This wraps the same `9router` binary you have installed locally so the
# hosted instance behaves identically to your dev one.

FROM node:20-alpine

RUN apk add --no-cache ca-certificates

# 9router pins react/react-dom 19 — pull peer deps with --legacy-peer-deps to be safe.
RUN npm install -g --legacy-peer-deps 9router@latest

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# 9router persists its SQLite DB and config under $HOME/.9router (i.e. /root/.9router
# in this image since it runs as root). Mount a named volume there in compose to persist
# the dashboard password and saved configuration across container recreations.
VOLUME ["/root/.9router"]

# 9router CLI options: -p port, -H host, -l logs
# Auth env vars: INITIAL_PASSWORD (seeds dashboard password on first run), JWT_SECRET
ENTRYPOINT ["9router", "-p", "3000", "-H", "0.0.0.0", "-l", "--skip-update"]
