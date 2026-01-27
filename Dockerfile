FROM node:25-alpine AS dependencies

WORKDIR /app
COPY ./ ./
RUN npm ci --omit dev

EXPOSE 8042 8080
ENTRYPOINT ["npm", "run"]
CMD ["start"]
