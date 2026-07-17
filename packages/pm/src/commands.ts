export { clean, cleanTarget } from "./commands/clean.ts";
export {
    binList,
    binRemove,
    binSet,
    installGlobal,
    prune,
    removeGlobal,
} from "./commands/global.ts";
export { init } from "./commands/init.ts";
export { info, list } from "./commands/inspect.ts";
export {
    type AddOptions,
    type AddRegistryOptions,
    add,
    addRegistry,
    addWorkspace,
    approve,
    install,
    remove,
    update,
} from "./commands/install.ts";
export { link, unlink } from "./commands/link.ts";
