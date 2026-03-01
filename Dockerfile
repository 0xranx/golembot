FROM node:22-slim

RUN npm install -g golembot

WORKDIR /assistant
COPY . .

RUN if [ -f package.json ]; then npm install --omit=dev; fi

EXPOSE 3000

CMD ["golembot", "gateway"]
