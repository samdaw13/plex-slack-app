FROM node:20-slim AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skip scripts since we don't need git hooks in Docker)
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /usr/src/app/dist ./dist

# Expose port (will be overridden by PORT env var at runtime)
EXPOSE 8080

# Run the app
CMD ["npm", "run", "start"]
