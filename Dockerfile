# Use Node.js LTS with Alpine for smaller size
FROM node:18-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create temp directory for HLS files
RUN mkdir -p /tmp

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
