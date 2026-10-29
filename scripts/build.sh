#!/usr/bin/env bash
# Builds Switchback's trail tiles from OpenStreetMap, one US state at a time.
# Data © OpenStreetMap contributors, Open Database License (ODbL). Downloads from Geofabrik.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf work frag out && mkdir -p work frag out
done_count=0
for s in $(cat scripts/states.txt); do
  echo "::group::$s"
  if ! curl -fsSL --retry 3 --retry-delay 20 -o "work/$s.osm.pbf" "https://download.geofabrik.de/north-america/us/$s-latest.osm.pbf"; then
    echo "::warning::Couldn't download $s, skipping it this month"; echo "::endgroup::"; continue
  fi
  # Paths, footways, bridleways, and hiking routes (plus the ways those routes use).
  osmium tags-filter "work/$s.osm.pbf" w/highway=path,footway,bridleway r/route=hiking,foot -o work/f.osm.pbf --overwrite
  osmium add-locations-to-ways work/f.osm.pbf -o work/l.osm.pbf --overwrite
  osmium cat work/l.osm.pbf -t relation -f opl,add_metadata=false -o work/rel.opl --overwrite
  osmium cat work/l.osm.pbf -t way -F pbf,locations_on_ways=true -f opl,add_metadata=false,locations_on_ways=true | node scripts/state.mjs work/rel.opl frag
  rm -f work/*.pbf work/rel.opl
  done_count=$((done_count + 1))
  echo "::endgroup::"
done
if [ "$done_count" -lt 40 ]; then echo "::error::Only $done_count states built; not publishing a partial map."; exit 1; fi
node scripts/finish.mjs frag out/tiles/v1
