FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data DEBUG=False
WORKDIR /app
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home workspace && mkdir /data && chown workspace:workspace /data
COPY server ./server
COPY extension ./extension
COPY prototype/dist/client ./prototype/dist/client
COPY deploy/container-entrypoint.sh /usr/local/bin/workspace-entrypoint
RUN chmod 755 /usr/local/bin/workspace-entrypoint
USER workspace
WORKDIR /app/server
EXPOSE 8000
ENTRYPOINT ["workspace-entrypoint"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "--worker-class", "gthread", "--timeout", "45", "--max-requests", "1000", "--max-requests-jitter", "100"]
