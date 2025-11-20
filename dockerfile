# Use a modern, small Node runtime
FROM node:22-slim

# Set working directory inside the container
WORKDIR /app

# Install only what is needed
# 1️⃣ Copy only the package manifests first
COPY package.json package-lock.json* ./

# 2️⃣ Install dependencies (npm ci if lockfile is present)
RUN npm ci --omit=dev || npm install --production

# 3️⃣ Copy the rest of the source code
COPY src ./src
COPY cache ./cache
COPY jsconfig.json ./
COPY README.md ./

# 4️⃣ Set environment for production
ENV NODE_ENV=production

# 5️⃣ Run the agent
CMD ["npm", "start"]
