# Switchback trail tiles

Builds the trail data the Switchback app uses, from OpenStreetMap, once a month.

- **What:** named paths, footways, and bridleways (no sidewalks, crossings, or private paths) and hiking routes in the US, cut into 0.25° tiles.
- **Where:** Cloudflare R2, bucket `switchback-trails`, folder `tiles/v1/`. `coverage.json` lists every tile with trails.
- **When:** the 2nd of each month, or anytime from **Actions > Build trail tiles > Run workflow**.
- **Secrets:** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` (Settings > Secrets and variables > Actions).

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). This repository is the published method for making these tiles from that data.
