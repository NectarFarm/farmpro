# Local Docker workflow. Every target is idempotent: running `make up`
# twice replaces the same containers instead of leaving another one behind.
#
#   make up        start db + app (production-shaped image)
#   make dev       start db + hot-reloading dev server (no rebuild on git pull)
#   make down      stop everything, keep the database
#   make logs      follow logs
#   make rebuild   force a fresh image build, then start
#   make migrate   run drizzle migrations
#   make seed      seed demo data
#   make psql      open a psql shell on the dev database
#   make reset-db  DESTRUCTIVE: drop the database volume and re-seed

COMPOSE := docker compose
# BuildKit is what makes the pnpm-store cache mount in the Dockerfile work.
export DOCKER_BUILDKIT := 1

.DEFAULT_GOAL := help
.PHONY: help up dev down stop logs ps rebuild migrate seed psql reset-db clean

help:
	@grep -E '^#   make' $(MAKEFILE_LIST) | sed 's/^#   //'

up:
	$(COMPOSE) up -d --build app
	@echo "app  -> http://localhost:13001"
	@echo "db   -> postgres://postgres:ifms@localhost:55433/ifms"

dev:
	$(COMPOSE) --profile dev up -d --build dev
	@echo "dev  -> http://localhost:13001 (source is bind-mounted; edits and"
	@echo "        git pulls apply live, no rebuild needed)"
	$(COMPOSE) --profile dev logs -f dev

# Stops and removes the containers but keeps the pgdata volume.
down:
	$(COMPOSE) --profile dev --profile tools down --remove-orphans

# Leaves the containers in place, just halts them.
stop:
	$(COMPOSE) --profile dev stop

logs:
	$(COMPOSE) --profile dev logs -f --tail=100

ps:
	$(COMPOSE) --profile dev --profile tools ps

# Only needed when a cached layer is genuinely stale; ordinary code changes
# do not require it.
rebuild:
	$(COMPOSE) build --no-cache app
	$(COMPOSE) up -d app

migrate:
	$(COMPOSE) --profile tools run --rm migrate

seed:
	$(COMPOSE) --profile tools run --rm seed

psql:
	$(COMPOSE) exec db psql -U postgres -d ifms

# Wipes the database volume, brings Postgres back, migrates and re-seeds.
reset-db:
	$(COMPOSE) --profile dev --profile tools down -v --remove-orphans
	$(COMPOSE) up -d db
	$(COMPOSE) --profile tools run --rm migrate
	$(COMPOSE) --profile tools run --rm seed

# Removes containers, the database volume and the built images.
clean:
	$(COMPOSE) --profile dev --profile tools down -v --remove-orphans --rmi local
