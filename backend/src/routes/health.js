const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/health — System health check
router.get('/', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() as time, current_database() as db');
    const row = dbResult.rows[0];

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        connected: true,
        time: row.time,
        name: row.db
      },
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0'
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: { connected: false, error: err.message }
    });
  }
});

module.exports = router;
