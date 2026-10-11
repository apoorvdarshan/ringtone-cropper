FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates ffmpeg \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]==2026.8.19' \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/yt-dlp/bin:${PATH}" \
    NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY --chown=node:node server.js ./server.js
USER node
EXPOSE 8080
CMD ["node", "server.js"]
