all: lint test

.PHONY: image
image:
	docker build -t homed-server-google .

install:
	@brew bundle check --quiet || brew bundle install
	@npm i

lint:
	@prettier --write src tests
	@eslint src tests --fix
	@tsc --noEmit

test:
	@npm test
