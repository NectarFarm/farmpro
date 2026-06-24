# Running IFMS with Docker

The whole system (Postgres + migrations + seed + the Next.js app) comes up with one command.

## Prerequisites
- Docker + Docker Compose v2
- Ports `13000` (app) and `55432` (Postgres) free — **stop the old dev setup first** if it's running:
  ```bash
  docker stop ifms-pg            # the manually-started Postgres, if any
  # and stop any `pnpm dev` server on 13000
  ```

## Start everything
```bash
cd Frontend
docker compose up --build
```
This will, in order:
1. Start **Postgres** (`db`) and wait until it's healthy.
2. Run **`migrate`** — applies all Drizzle migrations, then seeds demo data (idempotent, then exits).
3. Start the **app** at **http://localhost:13000**.

Run detached with `-d`. Stop with `docker compose down` (add `-v` to also wipe the database volume).

## Configuration
Compose reads variables from a `.env` file in this folder (and the shell). Useful ones:

| Variable | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | dev placeholder | **Set a long random value in production** (≥ 32 chars). |
| `POSTGRES_PASSWORD` | `ifms` | Database password. |
| `OPENROUTER_API_KEY` | _(empty)_ | Enables the AI Advisor. |
| `OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | Any OpenRouter model id. |
| `APP_PORT` | `13000` | Host port for the app. |
| `DB_PORT` | `55432` | Host port for Postgres. |

## Logins (after seed)
- Owner: `kutswa@ifms.farm` / `demo1234`
- Worker: `+254700333444` / `1234`
- Platform admin: `admin@ifms.app` / `demo1234`

## Common commands
```bash
docker compose logs -f app        # tail app logs
docker compose run --rm migrate   # re-run migrations + seed
docker compose build app          # rebuild just the app image
docker compose down -v            # stop and DELETE the database
```

> The compose database is its **own fresh volume** (`ifms_pgdata`), separate from any
> previously hand-started `ifms-pg` container. To carry over data from an old container,
> `pg_dump` it and restore into the compose `db` service.
