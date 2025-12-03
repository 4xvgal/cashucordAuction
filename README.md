# cashucordauction

Discord auction house powered by Cashu ecash. Users can deposit, bid with collateral requirements, and withdraw or pay Lightning invoices straight from Discord.

## Getting Started

1. Install dependencies

   ```bash
   bun install
   ```

2. Copy `.env` and set the required credentials (Discord bot, DB, Cashu mint, encryption key). Configure `BOT_ADMIN_IDS` with a comma-separated list of Discord user IDs that should act as mint/auction admins. For local development, `DATABASE_URL` points at `localhost:5432`; Docker Compose uses `DOCKER_DATABASE_URL` so the bot can reach the `postgres` service. The default `MINT_URL` talks to `localhost:3338` while `MINT_URL_INTERNAL` is used by the bot container to reach the `mint` service. The defaults can also target the public test mints:

   - `https://testnut.cashu.space` (includes fees)
   - `https://nofees.testnut.cashu.space` (no fees, great for local testing)

3. Run the bot locally

   ```bash
   bun start
   ```

   The bot automatically runs a background finalizer that settles ended auctions every 15 seconds. Tweak the cadence via `AUCTION_FINALIZER_INTERVAL_MS`.

## Local Nutshell Mint

Use the official [cashubtc/nutshell](https://github.com/cashubtc/nutshell) images to run a disposable mint for development:

```bash
# Start the mint on http://localhost:3338
bun run mint:up

# Tear it down when you are done
bun run mint:down
```

The default `.env` already points `MINT_URL` and `LOCAL_MINT_URL` to `http://localhost:3338`, so the bot plus the Bun tests will automatically target the local mint. Adjust `DEFAULT_COLLATERAL_RATIO` (1–100) to set the fallback percentage used when users omit the option in `/auction create`. When running the full docker compose stack the `bot` service connects to the `mint` service via the internal hostname `http://mint:3338`.

### Slash Commands & Permissions

- `/auction create` – create new auctions with collateral ratios and custom durations (seller-level).
- `/auction list` – browse active/ended/cancelled auctions with live bid data (everyone).
- `/auction cancel` – cancel an active auction (seller of that auction or a root admin).
- `/bid` – place bids with automatic collateral locking, anti-snipe extensions, and better error feedback (everyone).
- `/deposit` & `/withdraw` – Lightning invoice or Cashu token flows, including swap-based token redemption (everyone).
- `/balance` – view your own balance (everyone).
- `/admin balance` – inspect a user’s balance; restricted to root admins (IDs listed in `BOT_ADMIN_IDS`).

**Permission model**

- Root admins (from `BOT_ADMIN_IDS`) can cancel any auction and use `/admin` tools to inspect user balances.
- Sellers (users who created auctions) can cancel only their own auctions.
- Regular bidders can place bids, deposit, withdraw, and check their own balances but cannot manage auctions created by others.

### Tests

Tests rely on Bun’s built-in runner. The mint health spec pings three endpoints: your local Nutshell mint plus the two public `testnut` instances.

```bash
bun test
```

> **Note:** Start the local Nutshell mint (`bun run mint:up`) before running the test suite. You still need outbound access to `https://testnut.cashu.space` and `https://nofees.testnut.cashu.space` for the remote assertions.

## Docker & Compose

Build and run the bot plus Postgres (and the Nutshell mint) with Docker:

```bash
docker compose up --build
```

The compose file exposes Postgres on `localhost:5432`, Nutshell on `localhost:3338`, and passes sensible defaults to the bot container. Ensure your `.env` contains the Discord and Cashu secrets before starting.

## Database Migrations

Generate or apply migrations with Drizzle Kit:

```bash
bun run db:generate
bun run db:migrate
```

## Deploying Slash Commands

Once environment variables are set, publish slash commands with:

```bash
bun run deploy-commands
```
