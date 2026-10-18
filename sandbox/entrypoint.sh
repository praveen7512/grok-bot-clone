#!/usr/bin/env bash
# Starts the virtual desktop. Both VNC servers listen on 127.0.0.1 only (inside the container);
# the BotClone server reaches them through `docker exec socat`, so no port is ever published.
set -u
export DISPLAY="${DISPLAY:-:1}"
mkdir -p "$HOME/Desktop"

Xvfb "$DISPLAY" -screen 0 "${SCREEN_GEOMETRY:-1280x800x24}" -nolisten tcp &
for i in $(seq 1 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done

fluxbox >/dev/null 2>&1 &
xterm -geometry 100x30+40+40 -title "bot terminal" >/dev/null 2>&1 &

# 5900 = control, 5901 = view-only (enforced by x11vnc)
x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet -noxdamage >/dev/null 2>&1 &
x11vnc -display "$DISPLAY" -localhost -rfbport 5901 -forever -shared -nopw -quiet -noxdamage -viewonly >/dev/null 2>&1 &

# keep restarting crashed pieces; exit if X dies so Docker health/reaper can act
while sleep 5; do
  pgrep -x Xvfb >/dev/null || exit 1
  pgrep -x fluxbox >/dev/null || (fluxbox >/dev/null 2>&1 &)
  pgrep -f "rfbport 5900" >/dev/null || (x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet -noxdamage >/dev/null 2>&1 &)
  pgrep -f "rfbport 5901" >/dev/null || (x11vnc -display "$DISPLAY" -localhost -rfbport 5901 -forever -shared -nopw -quiet -noxdamage -viewonly >/dev/null 2>&1 &)
done
