FROM node:20-alpine

WORKDIR /app

# Copy package files and install
COPY package.json ./
RUN npm install --production=false

# Copy source
COPY src/ src/

# Build
RUN npx esbuild src/agent.ts --bundle --platform=node --target=node20 --outfile=dist/agent.js

# Run agent
CMD ["node", "dist/agent.js"]
