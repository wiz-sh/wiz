FROM oven/bun:1.3.14-alpine AS build

WORKDIR /workspace

COPY . .

RUN bun install --frozen-lockfile

RUN bun run --cwd apps/registry build

FROM oven/bun:1.3.14-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /workspace

COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/apps/registry apps/registry
COPY --from=build /workspace/packages/registry-client packages/registry-client

RUN mkdir -p /workspace/data/archives && chown -R bun:bun /workspace

USER bun

EXPOSE 3000

CMD ["bun", "apps/registry/src/server.ts"]
