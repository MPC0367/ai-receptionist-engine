#!/bin/sh
docker rm -f lk-redis lk-server lk-sip >/dev/null 2>&1; echo "stopped (colima still running: 'colima stop' to stop the VM)"
