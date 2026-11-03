# Code execution image for Braand coding agents.
# The donor image ships sandbox-shim, which @cloudflare/sandbox Files runs.
# Keep its tag equal to the installed @cloudflare/sandbox version (package.json).
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.3
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git ca-certificates curl build-essential sqlite3 jq ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
# The container holds no Braand secrets; each sandbox is a separate instance.
RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
