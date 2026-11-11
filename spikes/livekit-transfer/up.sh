#!/bin/sh
# Local LiveKit + SIP + Redis inside the colima VM (host networking there, as livekit/sip requires).
# The VM forwards its ports to this Mac's 127.0.0.1 (colima --port-forwarder grpc, so UDP works too).
set -e
cd "$(dirname "$0")"; . ./.env
docker rm -f lk-redis lk-server lk-sip >/dev/null 2>&1 || true
docker run -d --name lk-redis --network host redis:7.4-alpine redis-server --bind 127.0.0.1 --port 6379 --save "" >/dev/null
docker run -d --name lk-server --network host -e LIVEKIT_CONFIG="
port: 7880
bind_addresses: ['0.0.0.0']
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 127.0.0.1
redis:
  address: 127.0.0.1:6379
keys:
  $LK_KEY: $LK_SECRET
room:
  # the screened transfer mutes the caller server-side while staff is screened, then unmutes on DTMF 1
  enable_remote_unmute: true
logging:
  level: info
" livekit/livekit-server:v1.13 >/dev/null
docker run -d --name lk-sip --network host -e SIP_CONFIG_BODY="
api_key: $LK_KEY
api_secret: $LK_SECRET
ws_url: ws://127.0.0.1:7880
redis:
  address: 127.0.0.1:6379
sip_port: 5060
rtp_port: 10000-10050
nat_1_to_1_ip: 127.0.0.1
symmetric_rtp: true
log_level: debug
" livekit/sip:v1.23 >/dev/null
echo "started"
