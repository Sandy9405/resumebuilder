# Resume Builder: Node + headless Chromium (page layout, visual QA, PDF export).
#
# Microsoft's Playwright image ships Node, Chromium and every system library
# Chromium needs, so no apt step is required. Keep the tag and the playwright
# version below in lockstep: each Playwright release expects its own browser build.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
# Playwright is added here rather than in package.json so local machines that
# already have their own Playwright + browser pair are not disturbed.
RUN npm ci --omit=dev \
 && npm install --no-save --omit=dev playwright@1.63.0 \
 && npm cache clean --force

COPY --chown=pwuser:pwuser . .

# Railway injects PORT; 3000 is the local default.
EXPOSE 3000
USER pwuser
CMD ["node", "src/server.js"]
