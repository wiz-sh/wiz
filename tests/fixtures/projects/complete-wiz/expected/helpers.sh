#!/usr/bin/env bash
__wiz_assert_int() {
    if [[ ! "$2" =~ ^-?[0-9]+$ ]]; then
        printf 'wiz: %s must be int\n' "$1" >&2
        return 64
    fi
}

greet() {
    local name="$1"
    local port="$2"
    __wiz_assert_int 'port (src/helpers.wiz:1:20)' "$port" || return $?
    printf 'Hello, %s on %s!\n' "$name" "$port"
}
