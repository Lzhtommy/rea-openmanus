#!/bin/bash
# Sandbox entrypoint: a virtual display for the (headed) browser, exported over VNC on
# localhost only; the action API bridges it to the orchestrator at /vnc.
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  export DISPLAY=:99
  for _ in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
  x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet -noxdamage >/tmp/x11vnc.log 2>&1 &
fi
exec python3 /opt/sandbox/server.py
