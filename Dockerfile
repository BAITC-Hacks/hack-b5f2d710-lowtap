FROM node:24-alpine AS frontend

WORKDIR /build
COPY web/ ./web/
COPY data/*.json data/*.geojson ./data/
COPY data/scenarios/ ./data/scenarios/

# Vite resolves the shared dataset from ../data. Keep that layout while building.
# An empty frontend still produces a usable backend image with its JSON hint.
RUN mkdir -p /export/web \
    && if [ -f web/package.json ]; then \
         cd web \
         && npm ci \
         && npm run build \
         && cp -a dist /export/web/dist; \
       fi

FROM python:3.14-slim AS runtime

ENV PYTHONUTF8=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

# Explicit inputs exclude the repository's .env, virtualenv, and runtime cache.
# config.py resolves ROOT=/app from /app/backend/app/config.py.
COPY backend/app/ ./app/
COPY data/*.json data/*.geojson /app/data/
COPY data/scenarios/ /app/data/scenarios/
COPY data/cache/demo/ /app/data/cache/demo/
COPY --from=frontend /export/web/ /app/web/

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=300s --retries=5 \
    CMD ["python", "-c", "import json, urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2); assert json.load(response)['status'] == 'ok'"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
