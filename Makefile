.PHONY: image
image:
	docker build -t homed-server-google .

install:
	@brew bundle check --quiet || brew bundle install
	@npm i
