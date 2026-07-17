import { RedisClient } from "bun";
import { RegistryHttpError } from "../middleware/errors.ts";

interface MemoryCounter {
    count: number;
    expiresAt: number;
}

export class RateLimitService {
    readonly #redis?: RedisClient;

    readonly #memory = new Map<string, MemoryCounter>();

    constructor(redisUrl?: string) {
        if (redisUrl !== undefined) {
            this.#redis = new RedisClient(redisUrl);
        }
    }

    async check(
        key: string,
        maximum: number,
        windowSeconds: number,
    ): Promise<void> {
        const count =
            this.#redis === undefined
                ? this.incrementMemory(key, windowSeconds)
                : await this.incrementRedis(key, windowSeconds);

        if (count > maximum) {
            throw new RegistryHttpError(
                "RATE_LIMITED",
                429,
                "Request rate limit exceeded.",
                { retryAfterSeconds: windowSeconds },
            );
        }
    }

    close(): void {
        this.#redis?.close();
    }

    async ready(): Promise<boolean> {
        if (this.#redis === undefined) {
            return true;
        }

        try {
            return (await this.#redis.send("PING", [])) === "PONG";
        } catch {
            return false;
        }
    }

    private incrementMemory(key: string, windowSeconds: number): number {
        const now = Date.now();

        const previous = this.#memory.get(key);

        if (previous === undefined || previous.expiresAt <= now) {
            this.#memory.set(key, {
                count: 1,
                expiresAt: now + windowSeconds * 1_000,
            });

            return 1;
        }

        previous.count += 1;

        return previous.count;
    }

    private async incrementRedis(
        key: string,
        windowSeconds: number,
    ): Promise<number> {
        const count = await this.#redis?.incr(key);

        if (count === 1) {
            await this.#redis?.expire(key, windowSeconds);
        }

        return count ?? 1;
    }
}
