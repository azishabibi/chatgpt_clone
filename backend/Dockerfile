# backend/Dockerfile
FROM python:3.11

WORKDIR /app

COPY . .

RUN pip install fastapi uvicorn pymongo transformers python-dotenv torch motor passlib python-jose sentencepiece 

EXPOSE 8000

CMD ["uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]
