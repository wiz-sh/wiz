export type RuntimeHelper =
    | "int"
    | "bool"
    | "path"
    | "file"
    | "directory"
    | "bytes"
    | "bytes-command";

function byteCommandRuntime(): string {
    return `__wiz_bytes_directory="\${__wiz_bytes_directory:-}"

__wiz_bytes_error() {
    printf 'wiz: bytes: %s\\n' "$1" >&2
    return 64
}

__wiz_bytes_new_file() {
    if [ -z "$__wiz_bytes_directory" ]; then
        __wiz_bytes_directory="$(mktemp -d "\${TMPDIR:-/tmp}/wiz-bytes.XXXXXX")" || return $?
    fi

    __wiz_bytes_path="$(mktemp "$__wiz_bytes_directory/value.XXXXXX")"
}

__wiz_bytes_assign() {
    case "$1" in
        ""|[0-9]*|*[!A-Za-z0-9_]*) __wiz_bytes_error "invalid variable name: $1"; return $? ;;
        *) ;;
    esac

    export "$1=$2"
}

__wiz_bytes_capture() {
    [ "$#" -ge 3 ] || { __wiz_bytes_error 'usage: bytes capture <variable> -- <command> [arguments...]'; return $?; }

    __wiz_bytes_name="$1"
    shift

    [ "$1" = "--" ] || { __wiz_bytes_error 'capture requires -- before the command'; return $?; }
    shift

    __wiz_bytes_new_file || return $?
    "$@" > "$__wiz_bytes_path"
    __wiz_bytes_status=$?

    __wiz_bytes_assign "$__wiz_bytes_name" "$__wiz_bytes_path" || {
        rm -f -- "$__wiz_bytes_path"
        return $?
    }

    return "$__wiz_bytes_status"
}

__wiz_bytes_read() {
    [ "$#" -eq 2 ] || { __wiz_bytes_error 'usage: bytes read <variable> <file>'; return $?; }
    [ -f "$2" ] || { __wiz_bytes_error "file does not exist: $2"; return $?; }

    __wiz_bytes_new_file || return $?
    cp -- "$2" "$__wiz_bytes_path" || { rm -f -- "$__wiz_bytes_path"; return $?; }
    __wiz_bytes_assign "$1" "$__wiz_bytes_path"
}

__wiz_bytes_require() {
    [ -n "$__wiz_bytes_directory" ] || { __wiz_bytes_error 'value is not an owned bytes handle'; return $?; }

    case "$1" in
        "$__wiz_bytes_directory"/*) ;;
        *) __wiz_bytes_error 'value is not an owned bytes handle'; return $? ;;
    esac

    [ -f "$1" ] && [ ! -L "$1" ] || { __wiz_bytes_error 'value is not a live bytes handle'; return $?; }
}

__wiz_bytes_emit() {
    [ "$#" -eq 1 ] || { __wiz_bytes_error 'usage: bytes emit <value>'; return $?; }
    __wiz_bytes_require "$1" || return $?
    cat -- "$1"
}

__wiz_bytes_pipe() {
    [ "$#" -ge 3 ] || { __wiz_bytes_error 'usage: bytes pipe <value> -- <command> [arguments...]'; return $?; }
    __wiz_bytes_require "$1" || return $?

    __wiz_bytes_path="$1"
    shift

    [ "$1" = "--" ] || { __wiz_bytes_error 'pipe requires -- before the command'; return $?; }
    shift
    "$@" < "$__wiz_bytes_path"
}

__wiz_bytes_save() {
    [ "$#" -eq 2 ] || { __wiz_bytes_error 'usage: bytes save <value> <destination>'; return $?; }
    __wiz_bytes_require "$1" || return $?
    cp -- "$1" "$2"
}

__wiz_bytes_length() {
    [ "$#" -eq 1 ] || { __wiz_bytes_error 'usage: bytes length <value>'; return $?; }
    __wiz_bytes_require "$1" || return $?
    wc -c < "$1" | tr -d '[:space:]'
    printf '\\n'
}

__wiz_bytes_dispose() {
    [ "$#" -eq 1 ] || { __wiz_bytes_error 'usage: bytes dispose <value>'; return $?; }
    __wiz_bytes_require "$1" || return $?
    rm -f -- "$1" || return $?

    if rmdir "$__wiz_bytes_directory" 2>/dev/null; then
        __wiz_bytes_directory=""
    fi
}

__wiz_bytes() {
    __wiz_bytes_operation="\${1:-}"
    [ "$#" -gt 0 ] && shift

    case "$__wiz_bytes_operation" in
        capture) __wiz_bytes_capture "$@" ;;
        read) __wiz_bytes_read "$@" ;;
        emit) __wiz_bytes_emit "$@" ;;
        pipe) __wiz_bytes_pipe "$@" ;;
        save) __wiz_bytes_save "$@" ;;
        length) __wiz_bytes_length "$@" ;;
        dispose) __wiz_bytes_dispose "$@" ;;
        *) __wiz_bytes_error "unknown operation: $__wiz_bytes_operation" ;;
    esac
}
`;
}

function posixRuntimeHelper(type: RuntimeHelper): string {
    if (type === "bytes-command") {
        return byteCommandRuntime();
    }

    if (type === "bytes") {
        return `__wiz_assert_bytes() {
    [ -f "$2" ] || { printf 'wiz: %s must be a live bytes handle\\n' "$1" >&2; return 64; }
}
`;
    }

    if (type === "int") {
        return `__wiz_assert_int() {
    case "$2" in
        ""|-|*[!0-9-]*|?*-?*)
            printf 'wiz: %s must be int\\n' "$1" >&2
            return 64
            ;;
    esac
}
`;
    }

    if (type === "bool") {
        return `__wiz_assert_bool() {
    case "$2" in
        true|false) ;;
        *) printf 'wiz: %s must be bool\\n' "$1" >&2; return 64 ;;
    esac
}
`;
    }

    if (type === "file") {
        return `__wiz_assert_file() {
    [ -f "$2" ] || { printf 'wiz: %s must be a file\\n' "$1" >&2; return 64; }
}
`;
    }

    if (type === "directory") {
        return `__wiz_assert_directory() {
    [ -d "$2" ] || { printf 'wiz: %s must be a directory\\n' "$1" >&2; return 64; }
}
`;
    }

    return `__wiz_assert_path() {
    [ -n "$2" ] || { printf 'wiz: %s must be a path\\n' "$1" >&2; return 64; }
}
`;
}

export function runtimeHelper(
    type: RuntimeHelper,
    target: "bash" | "zsh" | "sh" = "bash",
): string {
    if (type === "bytes-command") {
        return byteCommandRuntime();
    }

    if (target !== "bash") {
        return posixRuntimeHelper(type);
    }

    if (type === "bytes") {
        return `__wiz_assert_bytes() {
    [[ -f "$2" ]] || { printf 'wiz: %s must be a live bytes handle\\n' "$1" >&2; return 64; }
}
`;
    }

    if (type === "int") {
        return `__wiz_assert_int() {
    if [[ ! "$2" =~ ^-?[0-9]+$ ]]; then
        printf 'wiz: %s must be int\\n' "$1" >&2
        return 64
    fi
}
`;
    }

    if (type === "bool") {
        return `__wiz_assert_bool() {
    if [[ "$2" != "true" && "$2" != "false" ]]; then
        printf 'wiz: %s must be bool\\n' "$1" >&2
        return 64
    fi
}
`;
    }

    if (type === "file") {
        return `__wiz_assert_file() {
    [[ -f "$2" ]] || { printf 'wiz: %s must be a file\\n' "$1" >&2; return 64; }
}
`;
    }

    if (type === "directory") {
        return `__wiz_assert_directory() {
    [[ -d "$2" ]] || { printf 'wiz: %s must be a directory\\n' "$1" >&2; return 64; }
}
`;
    }

    return `__wiz_assert_path() {
    [[ -n "$2" ]] || { printf 'wiz: %s must be a path\\n' "$1" >&2; return 64; }
}
`;
}
