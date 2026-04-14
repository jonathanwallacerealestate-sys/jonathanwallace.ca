const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /api/contact — Submit a contact form
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, message, source } = req.body;

    // Validation
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Save to database
    const result = await pool.query(
      `INSERT INTO contacts (name, email, phone, message, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [name, email, phone || null, message || null, source || 'website']
    );

    const contact = result.rows[0];

    // Log for webhook debugging
    await pool.query(
      `INSERT INTO webhook_logs (endpoint, method, payload, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5)`,
      ['/api/contact', 'POST', JSON.stringify({ name, email, source }), 201, JSON.stringify({ id: contact.id })]
    );

    res.status(201).json({
      success: true,
      id: contact.id,
      message: 'Contact form submitted successfully',
      created_at: contact.created_at
    });

  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to submit contact form' });
  }
});

// GET /api/contact — List recent contacts (protected)
router.get('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, name, email, phone, message, source, created_at, synced_to_fub
       FROM contacts
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM contacts');

    res.json({
      contacts: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset
    });

  } catch (err) {
    console.error('Contact list error:', err);
    res.status(500).json({ error: 'Failed to retrieve contacts' });
  }
});

module.exports = router;
