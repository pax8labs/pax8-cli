FROM mcr.microsoft.com/devcontainers/typescript-node:22

ENV PAX8_DEMO=1

RUN npm i -g pnpm

# Build the CLI in its monorepo context
COPY . /opt/pax8-cli
WORKDIR /opt/pax8-cli
RUN pnpm install --frozen-lockfile && pnpm build

# Create a wrapper so `pax8` is on PATH
RUN echo '#!/bin/sh\nnode /opt/pax8-cli/packages/cli/dist/index.js "$@"' > /usr/local/bin/pax8 \
    && chmod +x /usr/local/bin/pax8

WORKDIR /workspaces/pax8-cli
