.PHONY: image
image:
	docker build -t homed-server-google .

install:
	@brew bundle check --quiet || brew bundle install
	@npm i

lint:
	@npm run format
	@npm run lint

test:
	@npm test

all: lint test
