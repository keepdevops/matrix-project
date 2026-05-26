# Production: static React app behind nginx; API proxied to host Matrix proxy :3002
# Build (from repo root): docker compose -f production/docker-compose.prod.yml build
# Run:  see production/docker-compose.prod.yml

FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY public ./public
COPY src ./src

# Same-origin API via nginx → host proxy (set at build for CRA embed)
ARG REACT_APP_API_BASE=/api
ENV REACT_APP_API_BASE=$REACT_APP_API_BASE
ENV CI=true
ENV GENERATE_SOURCEMAP=false

RUN npm run build

FROM nginx:1.27-alpine

COPY production/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R g+r /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
