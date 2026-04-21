#!/bin/zsh
# VibeWire startup script — starts Vite dev server and Cloudflare tunnel
# Notifies Mac (main OpenClaw session) when tunnel URL is assigned

VIBEWIRE_DIR="$HOME/VibeWire"
LOG_DIR="/tmp/vibewire"
mkdir -p "$LOG_DIR"

# Start Vite
cd "$VIBEWIRE_DIR"
/opt/homebrew/bin/node node_modules/.bin/vite --host > "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo $VITE_PID > "$LOG_DIR/vite.pid"

# Wait for Vite to be ready
sleep 5

# Start cloudflared and capture the URL
/opt/homebrew/bin/cloudflared tunnel --url http://localhost:5173 > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
echo $TUNNEL_PID > "$LOG_DIR/tunnel.pid"

# Wait for URL to appear in log
for i in {1..20}; do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    echo "VibeWire tunnel URL: $URL" > "$LOG_DIR/current-url.txt"
    # Notify via openclaw to main discord session
    /opt/homebrew/bin/openclaw agent --message "VibeWire restarted. New URL: $URL" 2>/dev/null || true
    break
  fi
  sleep 2
done

wait $VITE_PID
