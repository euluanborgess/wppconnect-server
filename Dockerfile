FROM node:18-alpine

WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

ENV PORT=21465
EXPOSE 21465

CMD ["sh", "-c", "node dist/server.js || node dist/index.js"]
