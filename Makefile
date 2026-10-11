.PHONY: build up up-build down dev logs ps clean rebuild

build:
	cd backend && uv pip freeze > requirements.txt
	docker compose build

up:
	docker compose up

up-build: build up

down:
	docker compose down

dev:
	docker compose build
	docker compose watch

rebuild:
	docker compose build --no-cache
	docker compose up -d

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down --volumes --remove-orphans
	docker image prune -f
