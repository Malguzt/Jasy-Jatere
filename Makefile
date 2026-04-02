.PHONY: run run-with-stream-gateway stop logs clean rebuild map-smoke map-tests map-scenes

run:
	docker compose up -d

run-with-stream-gateway:
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

map-tests:
	docker compose run --rm backend npm test

map-scenes:
	docker compose up -d mapper
	docker compose exec mapper python scripts/validate_scenes.py --mapper-url http://localhost:5002/generate

map-smoke:
	./scripts/map_pipeline_smoke.sh
