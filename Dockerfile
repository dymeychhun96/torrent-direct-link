# Updated to perfectly match your new Playwright npm package
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Set the working directory inside the container
WORKDIR /app

# Copy dependency manifests and install
COPY package*.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port
EXPOSE 3000

# Start the Node.js server
CMD ["npm", "start"]