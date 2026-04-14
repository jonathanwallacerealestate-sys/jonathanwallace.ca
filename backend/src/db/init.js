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

      -- =========================================================
      --   Agent Dashboard Tables
      -- =========================================================

      -- Personal + business daily to-dos (manually added or agent-created)
      CREATE TABLE IF NOT EXISTS personal_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        category VARCHAR(50) DEFAULT 'personal',
        priority INTEGER DEFAULT 3,
        status VARCHAR(30) DEFAULT 'open',
        due_date DATE,
        completed_at TIMESTAMP WITH TIME ZONE,
        source VARCHAR(50) DEFAULT 'manual',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Emails flagged as needing attention (pushed from Gmail via Make.com)
      CREATE TABLE IF NOT EXISTS flagged_emails (
        id SERIAL PRIMARY KEY,
        gmail_message_id VARCHAR(255) UNIQUE,
        thread_id VARCHAR(255),
        from_address VARCHAR(255),
        from_name VARCHAR(255),
        subject TEXT,
        snippet TEXT,
        received_at TIMESTAMP WITH TIME ZONE,
        priority VARCHAR(30) DEFAULT 'normal',
        status VARCHAR(30) DEFAULT 'needs_reply',
        labels JSONB DEFAULT '[]',
        tag VARCHAR(100),
        assigned_to VARCHAR(100),
        handled_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Follow-Up Boss CRM follow-ups (pushed via FUB webhook / Make.com)
      CREATE TABLE IF NOT EXISTS crm_followups (
        id SERIAL PRIMARY KEY,
        fub_person_id VARCHAR(100),
        fub_event_id VARCHAR(100) UNIQUE,
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        stage VARCHAR(100),
        lead_source VARCHAR(100),
        follow_up_type VARCHAR(100),
        due_date DATE,
        notes TEXT,
        status VARCHAR(30) DEFAULT 'open',
        last_activity_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Daily calendar snapshot (pushed from Google Calendar via Make.com)
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        google_event_id VARCHAR(255) UNIQUE,
        calendar_id VARCHAR(255),
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE,
        all_day BOOLEAN DEFAULT FALSE,
        attendees JSONB DEFAULT '[]',
        meeting_link TEXT,
        event_type VARCHAR(50),
        status VARCHAR(30) DEFAULT 'confirmed',
        last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Closings + P&L tracking
      CREATE TABLE IF NOT EXISTS closings (
        id SERIAL PRIMARY KEY,
        property_address TEXT NOT NULL,
        city VARCHAR(100),
        client_name VARCHAR(255),
        client_type VARCHAR(30),
        transaction_side VARCHAR(30),
        sale_price NUMERIC(12,2),
        commission_rate NUMERIC(5,3),
        gross_commission NUMERIC(12,2),
        brokerage_split NUMERIC(12,2),
        referral_fees NUMERIC(12,2) DEFAULT 0,
        marketing_expense NUMERIC(12,2) DEFAULT 0,
        other_expenses NUMERIC(12,2) DEFAULT 0,
        net_profit NUMERIC(12,2),
        offer_date DATE,
        firm_date DATE,
        closing_date DATE,
        status VARCHAR(50) DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Workouts
      CREATE TABLE IF NOT EXISTS workouts (
        id SERIAL PRIMARY KEY,
        workout_date DATE NOT NULL,
        workout_type VARCHAR(100),
        title VARCHAR(255),
        exercises JSONB DEFAULT '[]',
        duration_minutes INTEGER,
        intensity VARCHAR(30),
        calories_burned INTEGER,
        notes TEXT,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Meal prep and daily meal plan
      CREATE TABLE IF NOT EXISTS meal_plan (
        id SERIAL PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_type VARCHAR(30) NOT NULL,
        name VARCHAR(255),
        ingredients JSONB DEFAULT '[]',
        calories INTEGER,
        protein_g INTEGER,
        carbs_g INTEGER,
        fat_g INTEGER,
        prep_notes TEXT,
        prepped BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Marketing campaigns / scheduled social posts / ad pushes
      CREATE TABLE IF NOT EXISTS marketing_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        platform VARCHAR(100),
        campaign_type VARCHAR(100),
        content TEXT,
        media_urls JSONB DEFAULT '[]',
        scheduled_for TIMESTAMP WITH TIME ZONE,
        status VARCHAR(30) DEFAULT 'draft',
        listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
        metrics JSONB DEFAULT '{}',
        external_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Extensible custom sections (add new dashboard categories on the fly)
      CREATE TABLE IF NOT EXISTS dashboard_categories (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        icon VARCHAR(50),
        color VARCHAR(30),
        sort_order INTEGER DEFAULT 100,
        is_builtin BOOLEAN DEFAULT FALSE,
        enabled BOOLEAN DEFAULT TRUE,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Free-form items attached to custom categories
      CREATE TABLE IF NOT EXISTS custom_items (
        id SERIAL PRIMARY KEY,
        category_slug VARCHAR(100) NOT NULL REFERENCES dashboard_categories(slug) ON DELETE CASCADE,
        title TEXT NOT NULL,
        details TEXT,
        data JSONB DEFAULT '{}',
        status VARCHAR(30) DEFAULT 'open',
        due_date DATE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
      CREATE INDEX IF NOT EXISTS idx_ptasks_status ON personal_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_ptasks_due ON personal_tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_ptasks_category ON personal_tasks(category);
      CREATE INDEX IF NOT EXISTS idx_flagged_emails_status ON flagged_emails(status);
      CREATE INDEX IF NOT EXISTS idx_flagged_emails_received ON flagged_emails(received_at);
      CREATE INDEX IF NOT EXISTS idx_crm_followups_due ON crm_followups(due_date);
      CREATE INDEX IF NOT EXISTS idx_crm_followups_status ON crm_followups(status);
      CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
      CREATE INDEX IF NOT EXISTS idx_closings_status ON closings(status);
      CREATE INDEX IF NOT EXISTS idx_closings_close_date ON closings(closing_date);
      CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);
      CREATE INDEX IF NOT EXISTS idx_meals_date ON meal_plan(meal_date);
      CREATE INDEX IF NOT EXISTS idx_marketing_scheduled ON marketing_items(scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_marketing_status ON marketing_items(status);
      CREATE INDEX IF NOT EXISTS idx_custom_items_category ON custom_items(category_slug);
      CREATE INDEX IF NOT EXISTS idx_custom_items_status ON custom_items(status);
    `);

    // Seed the built-in dashboard categories so the UI can render consistent ordering
    await client.query(`
      INSERT INTO dashboard_categories (slug, name, icon, color, sort_order, is_builtin)
      VALUES
        ('tasks',      'Agent Tasks',        'bolt',       '#1a1a2e', 10,  TRUE),
        ('emails',     'Email Triage',       'mail',       '#3b82f6', 20,  TRUE),
        ('crm',        'CRM Follow-ups',     'users',      '#8b5cf6', 30,  TRUE),
        ('calendar',   'Daily Calendar',     'calendar',   '#10b981', 40,  TRUE),
        ('closings',   'Closings & P&L',     'dollar',     '#f59e0b', 50,  TRUE),
        ('personal',   'Personal Tasks',     'check',      '#6366f1', 60,  TRUE),
        ('workouts',   'Workouts',           'dumbbell',   '#ef4444', 70,  TRUE),
        ('meals',      'Meal Prep',          'utensils',   '#84cc16', 80,  TRUE),
        ('marketing',  'Marketing',          'megaphone',  '#ec4899', 90,  TRUE)
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            icon = EXCLUDED.icon,
            color = EXCLUDED.color,
            sort_order = EXCLUDED.sort_order,
            is_builtin = EXCLUDED.is_builtin;
    `);

    console.log('Database tables verified/created');
  } finally {
    client.release();
  }
}

module.exports = { initDb };
