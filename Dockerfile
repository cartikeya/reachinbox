FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/web/package.json apps/web/package.json
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/migrations migrations
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
