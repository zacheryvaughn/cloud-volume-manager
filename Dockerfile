# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create workspace directory and set permissions
RUN mkdir -p /workspace && \
    chown -R nodejs:nodejs /workspace && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set environment variables
ENV NODE_ENV=production
ENV MOUNT_PATH=/workspace
ENV PORT=1080

# Expose the application port
EXPOSE 1080

# Health check to ensure the application is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:1080/ || exit 1

# Start the application
CMD ["node", "server.js"]

# LATEST: docker buildx build --platform linux/amd64 -t zacvaughndev/cloud-volume-manager:v5 --push .