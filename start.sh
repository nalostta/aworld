#!/bin/sh
set -e

# Start Uvicorn in the background
uvicorn server:app --host 0.0.0.0 --port 8000 &

# Start Nginx in the foreground
nginx -g 'daemon off;'
