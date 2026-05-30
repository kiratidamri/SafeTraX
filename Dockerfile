FROM node:22-alpine
WORKDIR /app

# Copy database schema
COPY database/ ./database/

# Install dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

EXPOSE 3000

ENV DB_PATH=/app/database/safetrax.db
ENV SCHEMA_PATH=/app/database/schema.sql

WORKDIR /app/backend
CMD ["node", "server.js"]
