# Organization-scoped package

The `@acme` scope belongs to the `acme` registry organization, not merely to a similarly named
user. Owners can require MFA and delegate publishing through a team.

```console
wiz org create acme "Acme Engineering"
wiz publish --access=public
```
