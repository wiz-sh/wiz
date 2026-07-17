export const isolatedEnvironment = (
    home: string,
): Record<string, string | undefined> => {
    return {
        ...process.env,
        HOME: home,
        WIZ_HOME: `${home}/.wiz`,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Wiz Tests",
        GIT_AUTHOR_EMAIL: "wiz@example.invalid",
        GIT_COMMITTER_NAME: "Wiz Tests",
        GIT_COMMITTER_EMAIL: "wiz@example.invalid",
    };
};
