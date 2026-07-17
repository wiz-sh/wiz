# Official Wiz type packages

These packages are maintained with Wiz and are published independently so a
project only installs the command surfaces it uses.

```console
wiz install @types/python
```

```wiz
source -T "@types/python/uv"
source -T "@types/common/git"
```

The Bash-native `source -T` declaration is erased during emission. Importing a
package without a subpath loads its aggregate `index.d.wiz` entry point. Bash,
coreutils, and Wiz declarations are bundled ambiently by default.
