FROM node:16

# Clean npm cache before starting
RUN npm cache clean --force

COPY package*.json ./

# Use clean install instead of npm install
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3001

CMD ["node", "build/index.js"]