const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/listings — Get active listings
router.get('/', async (req, res) => {
  try {
    const { city, status, type, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 200);

    let query = 'SELECT * FROM listings WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (status) {
      query += ` AND status = $${paramIdx++}`;
      params.push(status);
    } else {
      query += ` AND status = $${paramIdx++}`;
      params.push('active');
    }

    if (city) {
      query += ` AND LOWER(city) = LOWER($${paramIdx++})`;
      params.push(city);
    }

    if (type) {
      query += ` AND LOWER(property_type) = LOWER($${paramIdx++})`;
      params.push(type);
    }

    query += ` ORDER BY listed_date DESC NULLS LAST LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      listings: result.rows,
      total: result.rows.length,
      filters: { city, status: status || 'active', type }
    });

  } catch (err) {
    console.error('Listings error:', err);
    res.status(500).json({ error: 'Failed to retrieve listings' });
  }
});

// GET /api/listings/:id — Get single listing
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM listings WHERE id = $1 OR mls_number = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    res.json({ listing: result.rows[0] });

  } catch (err) {
    console.error('Listing detail error:', err);
    res.status(500).json({ error: 'Failed to retrieve listing' });
  }
});

// POST /api/listings — Create or update a listing (protected)
router.post('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      mls_number, address, city, price,
      bedrooms, bathrooms, square_footage, lot_size,
      property_type, description, features, images,
      status, listed_date
    } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const result = await pool.query(
      `INSERT INTO listings (
        mls_number, address, city, price,
        bedrooms, bathrooms, square_footage, lot_size,
        property_type, description, features, images,
        status, listed_date, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      ON CONFLICT (mls_number) DO UPDATE SET
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        price = EXCLUDED.price,
        bedrooms = EXCLUDED.bedrooms,
        bathrooms = EXCLUDED.bathrooms,
        square_footage = EXCLUDED.square_footage,
        lot_size = EXCLUDED.lot_size,
        property_type = EXCLUDED.property_type,
        description = EXCLUDED.description,
        features = EXCLUDED.features,
        images = EXCLUDED.images,
        status = EXCLUDED.status,
        listed_date = EXCLUDED.listed_date,
        updated_at = NOW()
      RETURNING id, mls_number, status`,
      [
        mls_number || null, address, city || null, price || null,
        bedrooms || null, bathrooms || null, square_footage || null, lot_size || null,
        property_type || null, description || null,
        JSON.stringify(features || []), JSON.stringify(images || []),
        status || 'active', listed_date || null
      ]
    );

    res.status(201).json({
      success: true,
      listing: result.rows[0]
    });

  } catch (err) {
    console.error('Listing create error:', err);
    res.status(500).json({ error: 'Failed to save listing' });
  }
});

module.exports = router;
