# Per-bot sandbox image: a small Debian desktop the bot can use and the owner can watch.
# Built as botclone-sandbox:latest (npm run sandbox:build or docker compose build).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    SCREEN_GEOMETRY=1280x800x24 \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb fluxbox x11vnc socat xterm x11-utils xdotool \
      ca-certificates curl wget git jq less nano procps unzip zip \
      python3 python3-pip python3-venv \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash bot

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

USER bot
WORKDIR /home/bot

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -x Xvfb >/dev/null && pgrep -x x11vnc >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
