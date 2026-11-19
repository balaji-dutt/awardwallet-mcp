FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/dist/awardwallet-mcp-remote.mjs ./
USER node
EXPOSE 8080
CMD ["node", "awardwallet-mcp-remote.mjs"]
