FROM node:25-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 8042 8080
ENTRYPOINT ["npm", "run"]
CMD ["start"]
