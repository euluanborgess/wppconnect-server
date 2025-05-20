FROM node:18-alpine

WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

ENV PORT=21465

EXPOSE 21465

CMD ["node", "dist/server.js"]
