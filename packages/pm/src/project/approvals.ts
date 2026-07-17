import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCodedError, WizError } from "../utils/errors.ts";
import { atomicWrite } from "../utils/filesystem.ts";
import {
    assertJsonKeys,
    type JsonObject,
    type JsonValue,
    parseJson,
    requireJsonObject,
    serializeJson,
} from "../utils/json.ts";

export interface ScriptApproval {
    repo: string;
    commit: string;
}

export interface ScriptApprovals {
    approvalVersion: 1;
    packages: Readonly<Record<string, ScriptApproval>>;
}

function validateApproval(value: JsonValue): ScriptApprovals {
    const root = requireJsonObject(value, "script approvals");

    assertJsonKeys(root, ["approvalVersion", "packages"], "approval");

    if (root.approvalVersion !== 1) {
        throw new WizError(
            "Unsupported or missing approvalVersion; expected 1",
        );
    }

    const packageRecords = requireJsonObject(
        root.packages,
        "script approval packages",
    );

    const packages: Record<string, ScriptApproval> = {};

    for (const [id, value] of Object.entries(packageRecords)) {
        const item = requireJsonObject(value, `script approval ${id}`);

        assertJsonKeys(item, ["repo", "commit"], `script approval ${id}`);

        if (
            id.length === 0 ||
            typeof item.repo !== "string" ||
            item.repo.length === 0 ||
            typeof item.commit !== "string" ||
            !/^[0-9a-f]{40,64}$/i.test(item.commit)
        ) {
            throw new WizError(
                `Script approval ${id} requires repo and commit`,
            );
        }

        packages[id] = {
            repo: item.repo,
            commit: item.commit,
        };
    }

    return { approvalVersion: 1, packages };
}

export async function readScriptApprovals(
    root: string,
): Promise<ScriptApprovals> {
    try {
        return validateApproval(
            parseJson(
                await readFile(join(root, "wiz.approvals.json"), "utf8"),
                "wiz.approvals.json",
            ),
        );
    } catch (err) {
        if (
            err instanceof Error &&
            isCodedError(err) &&
            err.code === "ENOENT"
        ) {
            return { approvalVersion: 1, packages: {} };
        }

        throw err;
    }
}

export async function writeScriptApprovals(
    root: string,
    approvals: ScriptApprovals,
): Promise<void> {
    const packages: JsonObject = {};

    for (const [id, approval] of Object.entries(approvals.packages).sort(
        ([a], [b]) => {
            return a.localeCompare(b);
        },
    )) {
        packages[id] = {
            repo: approval.repo,
            commit: approval.commit,
        };
    }

    await atomicWrite(
        join(root, "wiz.approvals.json"),
        serializeJson({ approvalVersion: 1, packages }),
    );
}

export function isScriptApproved(
    approvals: ScriptApprovals,
    id: string,
    repo: string,
    commit: string,
): boolean {
    const approval = approvals.packages[id];

    return approval?.repo === repo && approval.commit === commit;
}
