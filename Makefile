.PHONY: run stop logs clean rebuild

run:
	docker compose up -d

rebuild:
	docker compose up --build -d

stop:
	docker compose down

logs:
	docker compose logs -f

clean: stop
	docker compose rm -f
	docker image prune -a -f
