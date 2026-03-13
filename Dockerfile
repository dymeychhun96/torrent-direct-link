# Use the official Playwright image which includes all OS dependencies
FROM mcr.microsoft.com/playwright:v1.43.0-jammy

# Set the working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port your Express app runs on (update to match your server.js port)
EXPOSE 3000

# Start the server
CMD ["npm", "start"]