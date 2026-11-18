#!/bin/sh
# Rebuild BLUEPRINT-2026-11-11.md from parts/ in file order.
cd "$(dirname "$0")" && cat parts/*.md > BLUEPRINT-2026-11-11.md && wc -w BLUEPRINT-2026-11-11.md
