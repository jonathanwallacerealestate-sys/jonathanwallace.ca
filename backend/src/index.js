'use strict';

require('dotenv').config();

const { createApp } = require('./app');
const { resolveDataDir } = require('./store');

function start() {
  const dataDir = resolveDataDir();
  const port = Number(process.env.PORT) || 3000;
  const app = createApp({ dataDir });
  app.listen(port, '0.0.0.0', () => {
    console.log(`[wallace-desk] listening on ${port} data=${dataDir}`);
    if (!process.env.DESK_INGEST_TOKEN) {
      console.warn('[wallace-desk] DESK_INGEST_TOKEN is unset — POST /api/desk/snapshot will refuse');
    }
    if (!process.env.DESK_PIN && !process.env.DESK_INGEST_TOKEN) {
      console.warn('[wallace-desk] no DESK_PIN or DESK_INGEST_TOKEN — the desk UI is open');
    }
  });
}

if (require.main === module) start();

module.exports = { start };
