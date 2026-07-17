# Mixed registry and Git dependencies

This manifest routes `@internal` through a self-hosted registry while retaining a commit-pinned Git
dependency. `wiz install` records source-specific lock entries; a frozen reinstall cannot change a
registry version into Git or move the Git commit.

Replace the example URLs and revision before installing.
