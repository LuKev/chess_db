# Observability Stack

This folder contains local Prometheus + alerting configuration for Chess DB.

## Start services

```bash
docker compose up -d prometheus grafana
```

## Metrics endpoints

1. API metrics: `http://localhost:4000/metrics`
2. Worker metrics: `http://localhost:9465/metrics`
3. Prometheus UI: `http://localhost:9090`
4. Grafana UI: `http://localhost:3001` (anonymous viewer mode)

## Alert rules

Configured in `ops/observability/alerts.yml`:

1. API P95 latency over 500ms.
2. Combined queue depth over 100.
3. Worker failed-job rate above threshold.
