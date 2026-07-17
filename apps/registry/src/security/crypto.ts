import { timingSafeEqual as compareBytes } from "node:crypto";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes]
        .map((value) => {
            return value.toString(16).padStart(2, "0");
        })
        .join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64url");
}

/** Produces a cryptographically random URL-safe value without logging it. */
export function randomSecret(byteLength = 32): string {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** Hashes a secret together with a deployment-specific pepper. */
export async function hashSecret(
    secret: string,
    pepper: string,
): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${pepper}\u0000${secret}`),
    );

    return bytesToHex(new Uint8Array(digest));
}

/** Uses Bun's native Argon2id implementation with production-oriented costs. */
export function hashPassword(
    password: string,
    pepper: string,
): Promise<string> {
    return Bun.password.hash(`${password}\u0000${pepper}`, {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3,
    });
}

export function verifyPassword(
    password: string,
    pepper: string,
    hash: string,
): Promise<boolean> {
    return Bun.password.verify(`${password}\u0000${pepper}`, hash, "argon2id");
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(secret),
    );

    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
}

/** Encrypts MFA seeds at rest; the nonce is carried beside the ciphertext. */
export async function encryptSecret(
    value: string,
    secret: string,
): Promise<Uint8Array> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        await encryptionKey(secret),
        encoder.encode(value),
    );

    const result = new Uint8Array(nonce.length + encrypted.byteLength);

    result.set(nonce);
    result.set(new Uint8Array(encrypted), nonce.length);

    return result;
}

export async function decryptSecret(
    value: Uint8Array,
    secret: string,
): Promise<string> {
    const nonce = value.slice(0, 12);

    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        await encryptionKey(secret),
        value.slice(12),
    );

    return new TextDecoder().decode(plaintext);
}

/** Constant-time comparison avoids turning hashes and signatures into oracles. */
export function timingSafeEqual(left: string, right: string): boolean {
    const leftBytes = encoder.encode(left);

    const rightBytes = encoder.encode(right);

    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    return compareBytes(leftBytes, rightBytes);
}
