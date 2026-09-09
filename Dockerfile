# One image, three processes.
#
# The API, the console and the worker share a workspace, a lockfile and most of their
# dependencies, and building three images from one repository triples the build time to
# save nothing: the difference between them is one command. The command is chosen at run
# time, so what is tested in staging is byte for byte what runs in production.
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
# The lockfile is authority. A build that resolves versions of its own is a build that
# ships something nobody tested.
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @nx-verify/console run build

FROM build AS runtime
ENV NODE_ENV=production
# Never root. A process that only reads its own source has no business owning it.
USER node
EXPOSE 3000
# Overridden per process:
#   api      pnpm --filter @nx-verify/api run start
#   console  pnpm --filter @nx-verify/console run start
#   worker   pnpm --filter @nx-verify/worker run start
CMD ["pnpm", "--filter", "@nx-verify/api", "run", "start"]
