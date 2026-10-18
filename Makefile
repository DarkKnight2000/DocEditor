.PHONY: build up up-build down dev logs ps clean rebuild test upgrade-user deploy

# Add PROD=1 to run a command against production (docker-compose.prod.yml and the *.prod env files),
# e.g. make logs PROD=1. "make deploy" always uses production.
PROD_FILES = -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE = docker compose$(if $(PROD), $(PROD_FILES))

build:
	cd backend && uv pip freeze > requirements.txt
	$(COMPOSE) build

up:
	$(COMPOSE) up

up-build: build up

down:
	$(COMPOSE) down

dev:
	docker compose build
	docker compose watch

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

test:
	cd backend && uv run --with pytest pytest
	cd frontend && npm test

# Build and (re)start production in the background. Run on the server after pulling new code.
# --remove-orphans removes containers of services that no longer exist (e.g. the old nginx).
deploy:
	docker compose $(PROD_FILES) up -d --build --remove-orphans

# Remove the guest limits from an account: make upgrade-user EMAIL=someone@example.com [PROD=1]
# (the user must have signed in once; the email is passed as a psql variable, never pasted into the SQL)
upgrade-user:
	@test -n "$(EMAIL)" || (echo "Usage: make upgrade-user EMAIL=someone@example.com [PROD=1]"; exit 1)
	@echo "UPDATE users SET user_type = 'known' WHERE email = :'email' RETURNING name, email, user_type;" | \
		$(COMPOSE) exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -v email="$$1"' sh "$(EMAIL)"
