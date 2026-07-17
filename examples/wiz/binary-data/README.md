# Binary and NUL-safe data

Bash variables cannot contain byte `0x00`. Wiz therefore models `bytes` as an
opaque handle to file-backed data. The example captures a payload containing
two NUL bytes, measures it, saves it, reads it back, and emits an identical
copy without command substitution.

```console
wiz check
wiz c build
bash dist/main.sh
cmp dist/payload.bin dist/copied.bin
```

Expected output:

```text
Captured bytes: 16
```

Use `bytes pipe "$payload" -- command ...` to feed binary data directly to a
consumer. For NUL-delimited records, the same form works with `xargs -0`, while
Bash-native loops can continue using `read -r -d ''` against a process stream.
