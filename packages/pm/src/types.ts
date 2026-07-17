export interface GitDependencySpec {
    repo: string;
    branch?: string;
    commit?: string;
}

export interface WorkspaceDependencySpec {
    workspace: string;
}

export interface RegistryDependencySpec {
    version: string;
    registry?: string;
}

export interface LocalDependencySpec {
    path: string;
}

export type DependencySpec =
    | GitDependencySpec
    | WorkspaceDependencySpec
    | RegistryDependencySpec
    | LocalDependencySpec;

export interface Person {
    name: string;
    email?: string;
    url?: string;
}

export interface RepositoryMetadata {
    type: "git";
    url: string;
    directory?: string;
}

export interface PackageMetadata {
    name: string;
    version?: string;
    index?: string;
    description?: string;
    license?: string;
    author?: Person;
    contributors?: readonly Person[];
    contact?: string;
    repository?: RepositoryMetadata;
    homepage?: string;
    bugs?: { url?: string; email?: string };
    keywords?: readonly string[];
    funding?: readonly string[];
    links?: Readonly<Record<string, string>>;
    private?: boolean;
}

export interface Manifest {
    package: PackageMetadata;
    scripts: Readonly<Record<string, string>>;
    bins: Readonly<Record<string, string>>;
    dependencies: Readonly<Record<string, DependencySpec>>;
    workspaces?: readonly string[];
    registries?: {
        default?: string;
        scopes?: Readonly<Record<string, string>>;
    };
}

export interface LockedPackage {
    id: string;
    name: string;
    repo: string;
    requestedBranch?: string;
    resolvedBranch?: string;
    commit: string;
    direct: boolean;
    dependencies: Readonly<Record<string, string>>;
    workspacePath?: string;
    localPath?: string;
    source?:
        | {
              type: "git";
              repository: string;
              commit: string;
          }
        | {
              type: "registry";
              registry: string;
              package: string;
              version: string;
          }
        | {
              type: "local";
              path: string;
          };
    archive?: {
        url: string;
        integrity: string;
        size: number;
    };
}

export interface Lockfile {
    lockfileVersion: 1 | 2;
    rootDependencies: Readonly<Record<string, string>>;
    packages: readonly LockedPackage[];
}
