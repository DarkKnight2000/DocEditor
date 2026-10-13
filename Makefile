.PHONY: build up up-build down dev logs ps clean rebuild test upgrade-user

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

test:
	cd backend && uv run --with pytest pytest
	cd frontend && npm test

# Remove the guest limits from an account: make upgrade-user EMAIL=someone@example.com
# (the user must have signed in once; the email is passed as a psql variable, never pasted into the SQL)
upgrade-user:
	@test -n "$(EMAIL)" || (echo "Usage: make upgrade-user EMAIL=someone@example.com"; exit 1)
	@echo "UPDATE users SET user_type = 'known' WHERE email = :'email' RETURNING name, email, user_type;" | \
		docker compose exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -v email="$$1"' sh "$(EMAIL)"
