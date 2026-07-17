---
title: "Compiler architecture"
description: "Follow Wiz source from lossless parsing through binding, checking, target lowering, emission, and source maps."
---


`@wiz/compiler` keeps lexer, parser, immutable green tree/red navigation layer, semantic AST,
binder, checker, target backends, emitter, and source maps in one package.

```text
source → lossless tokens/tree → AST → scopes/symbols → checked project graph
       → target validation/lowering → shell writer → bundle/minify → output + source map
```

The lexer retains whitespace, comments, quote spelling, newlines, operators, and heredoc
bodies. Parser recovery returns a source file even for incomplete quotes or functions, so the
language service can continue answering. Stable entry points include `parseSourceFile`,
`createProgram`, `checkProgram`, `getDiagnostics`, and `emitProgram`.

The target boundary is `ShellTargetBackend`. Bash, Zsh, and `sh` backends consume
the same checked program without changing parser APIs. Bash and Zsh accept the
supported Bash-shaped syntax. The `sh` backend validates its portable feature
set first and reports `WIZ5003` for arrays, associative arrays, `[[ ... ]]`,
process substitution, arithmetic commands, or namerefs instead of emitting
behavior it cannot preserve.

`.wiz`, `.sh`, and `.zsh` roots can be fed through the pipeline. Translation
between dialects is intentionally limited to the syntax the selected backend
can preserve. The target controls the shebang, output suffix, declaration form,
runtime assertions, and rewritten static source paths.

Bundling stays inside `@wiz/compiler` because it consumes the checked source graph and lowered
target output. The bundler replaces inert source markers after every dependency has been emitted,
strips dependency shebangs, preserves execution order, and returns only graph entry points.
Creating a separate package would duplicate module resolution and weaken compiler invariants.
