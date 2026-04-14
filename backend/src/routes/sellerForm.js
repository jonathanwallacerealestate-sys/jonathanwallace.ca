const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const crypto = require('crypto');

// POST /api/seller-form — Create or update a seller pre-listing form
router.post('/', async (req, res) => {
  try {
    const {
      session_id,
      owner_name, email, phone,
      property_address, city, postal_code,
      property_type, bedrooms, bathrooms,
      square_footage, lot_size, year_built,
      upgrades, condition_rating,
      timeline, price_expectation, additional_notes,
      status
    } = req.body;

    // Validation
    if (!owner_name || !email || !property_address) {
      return res.status(400).json({
        error: 'Owner name, email, and property address are required'
      });
    }

    // Generate session_id if not provided (for new submissions)
    const sid = session_id || `sf-${crypto.randomUUID()}`;

    // Upsert — create new or update existing by session_id
    const result = await pool.query(
      `INSERT INTO seller_forms (
        session_id, owner_name, email, phone,
        property_address, city, postal_code,
        property_type, bedrooms, bathrooms,
        square_footage, lot_size, year_built,
        upgrades, condition_rating,
        timeline, price_expectation, additional_notes,
        status, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        owner_name = EXCLUDED.owner_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        property_address = EXCLUDED.property_address,
        city = EXCLUDED.city,
        postal_code = EXCLUDED.postal_code,
        property_type = EXCLUDED.property_type,
        bedrooms = EXCLUDED.bedrooms,
        bathrooms = EXCLUDED.bathrooms,
        square_footage = EXCLUDED.square_footage,
        lot_size = EXCLUDED.lot_size,
        year_built = EXCLUDED.year_built,
        upgrades = EXCLUDED.upgrades,
        condition_rating = EXCLUDED.condition_rating,
        timeline = EXCLUDED.timeline,
        price_expectation = EXCLUDED.price_expectation,
        additional_notes = EXCLUDED.additional_notes,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING id, session_id, status, created_at, updated_at`,
      [
        sid, owner_name, email, phone || null,
        property_address, city || null, postal_code || null,
        property_type || null, bedrooms || null, bathrooms || null,
        square_footage || null, lot_size || null, year_built || null,
        upgrades || null, condition_rating || null,
        timeline || null, price_expectation || null, additional_notes || null,
        status || 'draft'
      ]
    );

    const form = result.rows[0];

    res.status(201).json({
      success: true,
      id: form.id,
      session_id: form.session_id,
      status: form.status,
      created_at: form.created_at,
      updated_at: form.updated_at
    });

  } catch (err) {
    console.error('Seller form error:', err);
    res.status(500).json({ error: 'Failed to save seller form' });
  }
});

// GET /api/seller-form/:sessionId — Load a saved form by session ID
router.get('/:sessionId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM seller_forms WHERE session_id = $1`,
      [req.params.sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    res.json({ form: result.rows[0] });

  } catch (err) {
    console.error('Seller form load error:', err);
    res.status(500).json({ error: 'Failed to load seller form' });
  }
});

// GET /api/seller-form — List all forms (protected)
router.get('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let query = 'SELECT id, session_id, owner_name, email, property_address, city, status, created_at, updated_at FROM seller_forms';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({ forms: result.rows, total: result.rows.length });

  } catch (err) {
    console.error('Seller form list error:', err);
    res.status(500).json({ error: 'Failed to list seller forms' });
  }
});

module.exports = router;
