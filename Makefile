.PHONY: build up up-build down dev logs ps clean rebuild

# --env-file feeds compose's interpolation context: ${VAR} in docker-compose.yml and
# the valueless frontend build args. Every command that can build must include it,
# otherwise the frontend is built with empty secrets.
COMPOSE = docker compose --env-file frontend/.env --env-file postgres/postgres.env

build:
	cd backend && uv pip freeze > requirements.txt
	$(COMPOSE) build

up:
	$(COMPOSE) up

up-build: build up

down:
	$(COMPOSE) down

dev:
	$(COMPOSE) build
	$(COMPOSE) watch

rebuild:
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

clean:
	$(COMPOSE) down --volumes --remove-orphans
	docker image prune -f
