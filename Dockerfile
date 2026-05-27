# Use Node.js 20 slim image
FROM node:20-slim

# OpenSSL (Prisma) + pg_dump matching PostgreSQL 16 servers
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates wget gnupg \
    && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql-pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Expose the port (matching .env)
EXPOSE 5004

# Start the application
CMD ["npm", "start"]
