const pool = require('./pool');

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        message TEXT,
        source VARCHAR(100) DEFAULT 'website',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        synced_to_fub BOOLEAN DEFAULT FALSE,
        synced_to_make BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS seller_forms (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE,
        owner_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        property_address TEXT,
        city VARCHAR(100),
        postal_code VARCHAR(20),
        property_type VARCHAR(100),
        bedrooms INTEGER,
        bathrooms NUMERIC(3,1),
        square_footage INTEGER,
        lot_size VARCHAR(100),
        year_built INTEGER,
        upgrades TEXT,
        condition_rating VARCHAR(50),
        timeline VARCHAR(100),
        price_expectation VARCHAR(100),
        additional_notes TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        mls_number VARCHAR(50) UNIQUE,
        address TEXT NOT NULL,
        city VARCHAR(100),
        price NUMERIC(12,2),
        bedrooms INTEGER,
        bathrooms NUMERIC(3,1),
        square_footage INTEGER,
        lot_size VARCHAR(100),
        property_type VARCHAR(100),
        description TEXT,
        features JSONB DEFAULT '[]',
        images JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'active',
        listed_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        endpoint VARCHAR(255),
        method VARCHAR(10),
        payload JSONB,
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        instruction TEXT NOT NULL,
        context JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        result JSONB,
        error TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        source VARCHAR(100) DEFAULT 'api',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at);
      CREATE INDEX IF NOT EXISTS idx_seller_forms_session ON seller_forms(session_id);
      CREATE INDEX IF NOT EXISTS idx_seller_forms_email ON seller_forms(email);
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
      CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_endpoint ON webhook_logs(endpoint);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
    `);

    console.log('Database tables verified/created');
  } finally {
    client.release();
  }
}

module.exports = { initDb };
