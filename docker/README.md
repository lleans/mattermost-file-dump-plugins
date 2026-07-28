# Local QA stack

Brings up Mattermost, Postgres, MinIO, and APISIX (fronting MinIO) for manual
end-to-end testing of the file-dump plugin.

## Start

    docker compose -f docker/docker-compose.yml up -d

Mattermost: http://localhost:8065 (complete first-run setup to create an
admin account and a team).
APISIX-fronted MinIO: http://localhost:9080

## Sanity-check the presigned upload path before touching the UI

This isolates signature/CORS problems from browser/plugin issues.

1. Build the plugin (`make dist` from the repo root) and note the MinIO
   settings you configure in System Console (Task 10) — endpoint should be
   `localhost:9080`, SSL off.
2. From the plugin's own logs or a small Go snippet, obtain one presigned
   PUT URL (or temporarily log one from `handlePresign` during this check).
3. Confirm the raw PUT succeeds through the public APISIX hostname:

       curl -X PUT "<presigned-url>" --data-binary @/path/to/test-file.png -v

   Expected: `200 OK` / `HTTP/1.1 200`, not `SignatureDoesNotMatch`.

## Stop

    docker compose -f docker/docker-compose.yml down

Add `-v` to also remove volumes (wipes all data, including the MinIO bucket
and Mattermost database) if you want a clean slate.
