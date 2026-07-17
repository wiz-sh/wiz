#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/prefix.sh"

printf '%s %s\n' "$LOGGER_PREFIX" "${1:-empty message}"
