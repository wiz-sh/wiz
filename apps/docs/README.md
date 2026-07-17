# Wiz documentation site

The public documentation is an Astro Starlight application. Content lives in
`src/content/docs` and is checked by the production build.

```console
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
bun run --cwd apps/docs preview
```

Use Bun for dependency and script execution. Every content page needs Starlight
frontmatter with a title and description.
