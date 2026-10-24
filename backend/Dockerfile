FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
ENV DB_PATH=/data/reality_rift.db
EXPOSE 8000
# Pass GEMINI_API_KEY at runtime: docker run -e GEMINI_API_KEY=... -p 8000:8000 reality-rift-api
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
