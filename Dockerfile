FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV ENABLE_DOCS=0

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8000

# Single worker keeps in-memory queue state consistent.
CMD ["sh", "-c", "uvicorn app:app --host ${HOST} --port ${PORT}"]
