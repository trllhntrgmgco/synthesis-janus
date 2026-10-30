#!/usr/bin/env bash
# Start Synthesis-Janus from WSL. Spends no tokens unless you explicitly unlock the API:
#   JANUS_FLUENT=anthropic JANUS_ALLOW_API=1 ANTHROPIC_API_KEY=... ./start-janus.sh
cd "$(dirname "$0")"
export JANUS_FLUENT="${JANUS_FLUENT:-stub}"
node --no-warnings src/server.js
