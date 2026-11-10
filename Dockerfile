FROM python:3.12-slim
WORKDIR /app
COPY services/worker /app/services/worker
RUN python -m pip install --no-cache-dir -e /app/services/worker
RUN useradd --system --create-home career && mkdir /data && chown career:career /data
USER career
ENV CAREER_DB_PATH=/data/career.db
EXPOSE 8000
CMD ["python", "-m", "career.cli", "serve", "--host", "0.0.0.0", "--port", "8000"]
