import { timingSafeEqual } from "./crypto.ts";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Uint8Array {
    let bits = "";

    for (const character of value.replace(/=+$/, "").toUpperCase()) {
        const index = alphabet.indexOf(character);

        if (index < 0) {
            throw new Error("Invalid base32 secret");
        }

        bits += index.toString(2).padStart(5, "0");
    }

    const bytes: number[] = [];

    for (let index = 0; index + 8 <= bits.length; index += 8) {
        bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
    }

    return new Uint8Array(bytes);
}

export function createTotpSecret(byteLength = 20): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));

    let bits = "";

    for (const byte of bytes) {
        bits += byte.toString(2).padStart(8, "0");
    }

    let result = "";

    for (let index = 0; index < bits.length; index += 5) {
        result +=
            alphabet[
                Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)
            ];
    }

    return result;
}

export async function generateTotp(
    secret: string,
    timestamp: number,
    period = 30,
    digits = 6,
): Promise<{ code: string; counter: number }> {
    const counter = Math.floor(timestamp / 1_000 / period);

    const message = new Uint8Array(8);

    new DataView(message.buffer).setBigUint64(0, BigInt(counter));

    const key = await crypto.subtle.importKey(
        "raw",
        Uint8Array.from(decodeBase32(secret)),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"],
    );

    const digest = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, message),
    );

    const offset = (digest.at(-1) ?? 0) & 15;

    const value =
        (((digest[offset] ?? 0) & 127) << 24) |
        ((digest[offset + 1] ?? 0) << 16) |
        ((digest[offset + 2] ?? 0) << 8) |
        (digest[offset + 3] ?? 0);

    return {
        code: String(value % 10 ** digits).padStart(digits, "0"),
        counter,
    };
}

export async function verifyTotp(
    secret: string,
    code: string,
    timestamp: number,
    lastCounter?: bigint | null,
    skew = 1,
): Promise<number | undefined> {
    for (let window = -skew; window <= skew; window += 1) {
        const candidate = await generateTotp(
            secret,
            timestamp + window * 30_000,
        );

        if (
            timingSafeEqual(candidate.code, code) &&
            (lastCounter === undefined ||
                lastCounter === null ||
                BigInt(candidate.counter) > lastCounter)
        ) {
            return candidate.counter;
        }
    }

    return undefined;
}
