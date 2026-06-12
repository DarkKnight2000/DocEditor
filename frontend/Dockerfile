FROM node:24.16-slim

WORKDIR /code

COPY package.json package-lock.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]