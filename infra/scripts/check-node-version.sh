#!/bin/bash
# Usage: check-node-version.sh <path-to-.nvmrc>
set -e
required_node_major=$(tr -d '[:space:]v' < "${1:-.nvmrc}" | cut -d. -f1)
actual_node_major="${NODE_MAJOR_OVERRIDE:-$(node -p "process.versions.node.split('.')[0]")}"
if [[ "$required_node_major" != "$actual_node_major" ]]; then
    echo "ERROR: Node.js ${required_node_major}.x is required (found ${actual_node_major}.x)." >&2
    echo "       Switch with: nvm install ${required_node_major} && nvm use ${required_node_major}" >&2
    exit 1
fi
