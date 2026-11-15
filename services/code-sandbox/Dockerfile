# Code, video and motion-design image for Braand agents.
# The donor image ships sandbox-shim, which @cloudflare/sandbox Files runs.
# Keep its tag equal to the installed @cloudflare/sandbox version (package.json).
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.3
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM node:24-bookworm-slim
# Code: Python, git, build tools. Video: FFmpeg. Motion design: Chromium and
# good fonts (Inter, Noto incl. emoji) so compositions render consistently.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git ca-certificates curl build-essential sqlite3 jq ripgrep \
    ffmpeg chromium fonts-inter fonts-noto-core fonts-noto-color-emoji fonts-liberation fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && fc-cache -f
ENV CHROMIUM_PATH=/usr/bin/chromium PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --global playwright-core@1.58.2 && npm cache clean --force
# Python for data work, automation and files (Excel, Word, PowerPoint, PDF,
# charts). A virtual environment first in PATH: `python`, `python3` and `pip`
# use it, and users can `pip install` more packages without touching the system.
RUN python3 -m venv /opt/python \
 && /opt/python/bin/pip install --no-cache-dir \
    numpy==2.1.3 pandas==2.2.3 openpyxl==3.1.5 xlsxwriter==3.2.5 matplotlib==3.9.2 \
    requests==2.32.3 python-docx==1.1.2 python-pptx==1.0.2 pillow==11.0.0 reportlab==4.2.5 \
    beautifulsoup4==4.12.3 lxml==5.3.0 pypdf==5.1.0 pyyaml==6.0.2 \
 && /opt/python/bin/python -c "import pandas, openpyxl, docx, pptx, matplotlib, reportlab, pypdf"
ENV PATH=/opt/python/bin:$PATH MPLBACKEND=Agg
ENV NODE_PATH=/usr/local/lib/node_modules
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY motion/render-motion.mjs /opt/braand/render-motion.mjs
RUN printf '#!/bin/sh\nexec node /opt/braand/render-motion.mjs "$@"\n' > /usr/local/bin/render-motion && chmod +x /usr/local/bin/render-motion
# The container holds no Braand secrets; each sandbox is a separate instance.
RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
