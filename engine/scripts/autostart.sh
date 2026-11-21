#!/bin/sh
# Keep the public talk page running across restarts and crashes (macOS only).
#
# Installs two launchd agents for the signed-in user (they start at login, and launchd starts each again if it stops):
#   - the talk page: the project's PostgreSQL, then sim/talk/server.ts on 127.0.0.1:4520 in public mode;
#   - the Cloudflare tunnel that serves it at the public address, with caffeinate holding off idle sleep.
#
#   sh scripts/autostart.sh install <public-host> <tunnel-name> [tunnel-config.yml]
#   sh scripts/autostart.sh status
#   sh scripts/autostart.sh restart        # e.g. after changing the talk server's code
#   sh scripts/autostart.sh uninstall
#
# Logs: ~/Library/Logs/O2 Receptionist/. Keys come from engine/.env.local and the login shell, as with `npm run talk`.
# After a restart with FileVault on, nothing starts until the user signs in (launchd agents belong to a login).
set -eu

ENGINE=$(cd "$(dirname "$0")/.." && pwd)
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/O2 Receptionist"
TALK=com.o2designstudio.receptionist.talk
TUNNEL=com.o2designstudio.receptionist.tunnel
DOMAIN="gui/$(id -u)"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

stop_agent() {
  launchctl bootout "$DOMAIN/$1" 2>/dev/null || true
}

start_agent() {
  launchctl bootstrap "$DOMAIN" "$AGENTS/$1.plist"
  launchctl enable "$DOMAIN/$1"
}

case "${1:-}" in
install)
  HOST=${2:?usage: autostart.sh install <public-host> <tunnel-name> [tunnel-config.yml]}
  NAME=${3:?usage: autostart.sh install <public-host> <tunnel-name> [tunnel-config.yml]}
  CONFIG=${4:-$HOME/.cloudflared/$NAME.yml}
  CLOUDFLARED=$(command -v cloudflared || true)
  [ -n "$CLOUDFLARED" ] || { echo "cloudflared is not on PATH" >&2; exit 1; }
  [ -f "$CONFIG" ] || { echo "no tunnel settings at $CONFIG" >&2; exit 1; }
  mkdir -p "$AGENTS" "$LOGS"

  cat > "$AGENTS/$TALK.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$TALK</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "\$0" &amp;&amp; npm run -s db:start &amp;&amp; exec node --env-file-if-exists=.env.local sim/talk/server.ts</string>
    <string>$(xml "$ENGINE")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TALK_PUBLIC</key><string>1</string>
    <key>TALK_PUBLIC_HOST</key><string>$(xml "$HOST")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$(xml "$LOGS/talk.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOGS/talk.log")</string>
</dict>
</plist>
EOF

  cat > "$AGENTS/$TUNNEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$TUNNEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-is</string>
    <string>$(xml "$CLOUDFLARED")</string>
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--config</string>
    <string>$(xml "$CONFIG")</string>
    <string>run</string>
    <string>$(xml "$NAME")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$LOGS/tunnel.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOGS/tunnel.log")</string>
</dict>
</plist>
EOF

  plutil -lint "$AGENTS/$TALK.plist" "$AGENTS/$TUNNEL.plist" >/dev/null
  stop_agent "$TALK"; stop_agent "$TUNNEL"
  start_agent "$TALK"; start_agent "$TUNNEL"
  echo "installed: $TALK and $TUNNEL (logs in $LOGS)"
  ;;
status)
  for label in "$TALK" "$TUNNEL"; do
    if launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$label" | awk -v l="$label" '/^\tstate =|^\tpid =|last exit code/ { gsub(/^\t/, ""); s = s "  " $0 } END { print l ":" s }'
    else
      echo "$label: not installed"
    fi
  done
  ;;
restart)
  launchctl kickstart -k "$DOMAIN/$TALK"
  echo "restarted $TALK"
  ;;
uninstall)
  stop_agent "$TALK"; stop_agent "$TUNNEL"
  rm -f "$AGENTS/$TALK.plist" "$AGENTS/$TUNNEL.plist"
  echo "removed $TALK and $TUNNEL (PostgreSQL keeps running: npm run db:stop)"
  ;;
*)
  sed -n '2,13p' "$0"; exit 2
  ;;
esac
