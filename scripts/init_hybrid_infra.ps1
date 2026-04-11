$ErrorActionPreference = 'Stop'

Write-Host '[init] Starting hybrid infra (TimescaleDB + InfluxDB + Mosquitto)...'
docker compose up -d mosquitto timescaledb influxdb

Write-Host '[init] Done. Services status:'
docker compose ps
