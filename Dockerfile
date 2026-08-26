FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Build the application
RUN npm run build

# Expose the port Cloud Run uses
EXPOSE 3000

# Start the compiled server
CMD ["npm", "run", "start"]
