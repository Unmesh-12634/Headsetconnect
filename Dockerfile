# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build the FastAPI Python Backend
# ==========================================
FROM python:3.11-slim AS backend-runner

# Install system dependencies (ffmpeg, curl, ca-certificates, and unzip)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (required by yt-dlp to solve modern YouTube cryptographic signatures)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

WORKDIR /app

# Copy and install python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Force-upgrade yt-dlp to latest nightly at image build time.
# YouTube's anti-bot defences change frequently; running an outdated yt-dlp
# is the #1 cause of "Sign in to confirm you're not a bot" errors on cloud IPs.
RUN pip install --no-cache-dir --upgrade "yt-dlp[default]"

# Copy backend application files
COPY backend/ /app/

# Copy compiled frontend build assets into /frontend/dist so FastAPI main.py mounts it automatically
COPY --from=frontend-builder /frontend/dist /frontend/dist

# Expose target port (Render maps the dynamic host port via $PORT)
EXPOSE 8000
ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Run the API server
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
