# cashucordauction

Discord auction house powered by Cashu ecash. Users can deposit, bid with collateral requirements, and withdraw or pay Lightning invoices straight from Discord.

## Getting Started

1. Install dependencies

   ```bash
   bun install
   ```

2. Copy `.env` and set the required credentials (Discord bot, DB, Cashu mint, encryption key). Configure `BOT_ADMIN_IDS` with a comma-separated list of Discord user IDs that should act as mint/auction admins. `BOT_DEFAULT_LANGUAGE` controls the default response language (`en` or `ko`). Optional channels:
   - `AUCTION_RESULTS_CHANNEL_ID` – where final auction summaries are posted.
   - `AUDIT_LOG_CHANNEL_ID` – private log channel that receives the real winner when privacy mode is on.

   For local development, `DATABASE_URL` points at `localhost:5432`; Docker Compose uses `DOCKER_DATABASE_URL` so the bot can reach the `postgres` service. Set `MINT_URL` to the Cashu mint you plan to use (e.g., `http://localhost:3338` for a local Nutshell or `https://mint.minibits.cash/Bitcoin/` for an external mint). The entire toolchain references this variable—swap its value whenever you change environments. When you run the bot in Docker, you can override the value seen by the container via `BOT_MINT_URL` (default `http://mint:3338`) so the container talks to the in-network mint while the host keeps using `http://localhost:3338`. The `.env` file also includes Nutshell-specific knobs (`MINT_BACKEND_BOLT11_SAT`, `MINT_PRIVATE_KEY`, etc.) so you can spin up the bundled mint when needed; leave them untouched if you only rely on an external mint.

3. Run the bot locally

   ```bash
   bun start
   ```

   The bot automatically runs a background finalizer that settles ended auctions every 15 seconds. Tweak the cadence via `AUCTION_FINALIZER_INTERVAL_MS`.

### Slash Commands & Permissions

- `/auction create` – create new auctions with collateral ratios, custom durations, anti-snipe toggles, and a mode selector (`ENGLISH` or `VICKREY`). Sellers can still allow bidders to reveal themselves, but each bidder decides that per bid.
- `/auction list` – browse active/ended/cancelled auctions with live bid data (everyone).
- `/auction cancel` – cancel an active auction (seller of that auction or a root admin).
- `/bid` – place bids with automatic collateral locking. Use the `anonymous` toggle to hide your Discord ID in public updates.
- `/offer create|accept|decline` – submit direct purchase offers or have the seller/admin close the auction immediately by accepting one.
- `/deposit` & `/withdraw` – Lightning invoice or Cashu token flows, including swap-based token redemption (everyone).
- `/balance` – view your own balance (everyone).
- `/admin balance` – inspect a user’s balance; restricted to root admins (IDs listed in `BOT_ADMIN_IDS`).
- `/offer create|accept|decline` – submit or manage direct purchase offers.
- `/help <language?>` – show usage guidance in English or Korean (`/help ko`), defaulting to `BOT_DEFAULT_LANGUAGE`.

**Permission model**

- Root admins (from `BOT_ADMIN_IDS`) can cancel any auction and use `/admin` tools to inspect user balances.
- Sellers (users who created auctions) can cancel only their own auctions.
- Regular bidders can place bids, deposit, withdraw, and check their own balances but cannot manage auctions created by others.

- Each `/bid` has an `anonymous` option. When set to true, public embeds show aliases such as *Bidder #1234*, but the database (and seller/winner DMs) retain the real Discord ID. Anti-snipe extensions can be fully disabled or tuned per auction via `/auction create`.
- `/auction create` exposes the `mode` flag. In `VICKREY`, the highest bid still wins, but the winner only pays the second-highest price (or the starting price if they were the sole bidder). The final sale figures are displayed publicly, but the winner can remain hidden if they bid anonymously.
- `/offer` commands allow direct purchase offers outside the bidding stream. Accepting an offer immediately closes the auction, pays out the deposit token to the seller, and publishes the result.

### Tests

Tests rely on Bun’s built-in runner. The mint health spec simply pings whatever URL you set in `MINT_URL`, so pointing that variable at a different mint automatically switches the target for the suite.

```bash
bun test
```

## Docker & Compose

Build and run the bot plus Postgres (and an optional Nutshell mint) with Docker:

```bash
docker compose up --build
```

The compose file exposes Postgres on `localhost:5432`, runs a Nutshell mint on `localhost:3338`, and passes the `.env` values to the bot container. Set `BOT_MINT_URL` (or leave the default `http://mint:3338`) so the container can reach the mint via the Docker network, while `MINT_URL` on the host can stay at `http://localhost:3338`. Ensure your `.env` contains the Discord and Cashu secrets before starting; switch `MINT_URL`/`BOT_MINT_URL` to an external URL when you want to bypass the local mint.

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
## Local Nutshell Mint

Use the official [cashubtc/nutshell](https://github.com/cashubtc/nutshell) images (or `bun run mint:up` / `bun run mint:down` shortcuts) to run a disposable mint for development. When you start a mint on `http://localhost:3338`, update `MINT_URL` in `.env` to that address so the bot, tests, and Docker container all talk to it. Adjust `DEFAULT_COLLATERAL_RATIO` (1–100) to set the fallback percentage used when users omit the option in `/auction create`.
