export {
    packageInfo,
    readProject,
    readProjectIfPresent,
} from "./commands/context.ts";
export {
    createProject,
    listProjectTemplates,
    type ProjectTemplate,
} from "./commands/create.ts";
export { doctor, verifyCache, why } from "./commands/maintenance.ts";
export { materialize } from "./commands/materialize.ts";
export type { AddOptions, AddRegistryOptions } from "./commands.ts";
export {
    add,
    addRegistry,
    addWorkspace,
    approve,
    binList,
    binRemove,
    binSet,
    clean,
    cleanTarget,
    info,
    init,
    install,
    installGlobal,
    link,
    list,
    prune,
    remove,
    removeGlobal,
    unlink,
    update,
} from "./commands.ts";
export { resolveGit } from "./dependencies/git.ts";
export {
    instancePath,
    modulePath,
    resolveDependencies,
} from "./dependencies/resolver.ts";
export { ensureStored } from "./dependencies/store.ts";
export { readBinState } from "./global/bins.ts";
export { readGlobalLinks, readProjectLinks } from "./global/links.ts";
export { globalPackagePath } from "./global/packages.ts";
export type { BinRegistration } from "./global/registration.ts";
export {
    findProjectRoot,
    findProjectRootIfPresent,
    wizHome,
} from "./project/discovery.ts";
export {
    parseLockfile,
    readLockfile,
    serializeLockfile,
    validateLockfile,
    writeLockfile,
} from "./project/lockfile.ts";
export {
    MANIFEST_SCHEMA_URL,
    parseManifest,
    readManifest,
    serializeManifest,
    validateManifest,
} from "./project/manifest.ts";
export type {
    WorkspacePackage,
    WorkspaceProject,
} from "./project/workspaces.ts";
export {
    discoverWorkspaces,
    findWorkspaceRoot,
    findWorkspaceRootIfPresent,
    resolveWorkspacePackagePath,
} from "./project/workspaces.ts";
export * from "./types.ts";
export { errorMessage, WizError } from "./utils/errors.ts";
