.PHONY: build up down dev logs ps clean rebuild

build:
	docker compose --env-file frontend/.env build

up:
	docker compose up -d

up-build: build up

down:
	docker compose down

dev:
	docker compose --env-file frontend/.env build
	docker compose watch

rebuild:
	docker compose --env-file frontend/.env build --no-cache
	docker compose up -d

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down --volumes --remove-orphans
	docker image prune -f