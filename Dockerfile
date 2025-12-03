FROM oven/bun:1 as base

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json drizzle.config.ts ./
COPY src ./src

RUN bun install --frozen-lockfile

CMD ["bun", "start"]
