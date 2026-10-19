.PHONY: build up up-build down dev logs ps clean rebuild test upgrade-user deploy push

# Add PROD=1 to run a command against production (docker-compose.prod.yml and the *.prod env files),
# e.g. make logs PROD=1. "make deploy" always uses production.
PROD_FILES = -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE = docker compose$(if $(PROD), $(PROD_FILES))

# Image version for production: a commit hash from "make push", e.g. make deploy TAG=1a2b3c4 (default: latest)
TAG ?=
export TAG

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

# Build the frontend and backend images for the server (linux/amd64, also from an ARM machine) and push
# them to Docker Hub, tagged with the current commit and "latest". Run on a development machine after
# committing, and after "docker login" once. The recipe only uses commands that work in both sh and
# Windows cmd (which mingw32-make uses from PowerShell). IMAGE_PREFIX sets the Docker Hub account.
IMAGE_PREFIX ?= rishikaley72
COMMIT = $(shell git rev-parse --short HEAD)
push: export TAG = $(COMMIT)
push: export IMAGE_PREFIX := $(IMAGE_PREFIX)
push: export DOCKER_DEFAULT_PLATFORM = linux/amd64
push:
	@git diff --quiet HEAD || (echo Commit your changes first: images are tagged with the commit they are built from. && exit 1)
	docker compose build frontend backend
	docker tag $(IMAGE_PREFIX)/raya-frontend:$(COMMIT) $(IMAGE_PREFIX)/raya-frontend:latest
	docker tag $(IMAGE_PREFIX)/raya-backend:$(COMMIT) $(IMAGE_PREFIX)/raya-backend:latest
	docker push $(IMAGE_PREFIX)/raya-frontend:$(COMMIT)
	docker push $(IMAGE_PREFIX)/raya-frontend:latest
	docker push $(IMAGE_PREFIX)/raya-backend:$(COMMIT)
	docker push $(IMAGE_PREFIX)/raya-backend:latest
	@echo Pushed $(COMMIT). On the server: git pull, then make deploy (or make deploy TAG=$(COMMIT) to pin it)

# Pull the pushed images and (re)start production in the background. Run on the server after
# "make push" and "git pull"; nothing is built here.
# --remove-orphans removes containers of services that no longer exist (e.g. the old nginx).
deploy:
	docker compose $(PROD_FILES) pull frontend backend
	docker compose $(PROD_FILES) up -d --remove-orphans

# Remove the guest limits from an account: make upgrade-user EMAIL=someone@example.com [PROD=1]
# (the user must have signed in once; the email is passed as a psql variable, never pasted into the SQL)
upgrade-user:
	@test -n "$(EMAIL)" || (echo "Usage: make upgrade-user EMAIL=someone@example.com [PROD=1]"; exit 1)
	@echo "UPDATE users SET user_type = 'known' WHERE email = :'email' RETURNING name, email, user_type;" | \
		$(COMPOSE) exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -v email="$$1"' sh "$(EMAIL)"
