import { join } from "node:path";
import { wizHome } from "../project/discovery.ts";

export interface PackageIdentity {
    id?: string;
    resolvedBranch?: string;
    commit?: string;
}

export function lifecycleEnvironment(
    projectRoot: string,
    packageRoot: string,
    packageName: string,
    item?: PackageIdentity,
): Record<string, string> {
    const environment: Record<string, string> = {
        WIZ_HOME: wizHome(),
        WIZ_PROJECT_ROOT: projectRoot,
        WIZ_PACKAGE_ROOT: packageRoot,
        WIZ_MODULES_DIR: join(packageRoot, "wiz_modules"),
        WIZ_PACKAGE_NAME: packageName,
    };

    if (item?.id !== undefined) {
        environment.WIZ_PACKAGE_ID = item.id;
    }

    if (item?.resolvedBranch !== undefined) {
        environment.WIZ_PACKAGE_BRANCH = item.resolvedBranch;
    }

    if (item?.commit !== undefined) {
        environment.WIZ_PACKAGE_COMMIT = item.commit;
    }

    return environment;
}
