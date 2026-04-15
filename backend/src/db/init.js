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

      -- Key / value settings store for runtime-editable configuration
      -- (Make.com webhook URLs, timezone, daily goals, etc.)
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL DEFAULT 'null'::jsonb,
        description TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Encrypted credentials for services without APIs. Values are encrypted
      -- with AES-256-GCM using the CREDENTIALS_ENCRYPTION_KEY env var so a
      -- casual DB dump doesn't expose them.
      CREATE TABLE IF NOT EXISTS site_credentials (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        site VARCHAR(255),
        url TEXT,
        username TEXT,
        password_ciphertext TEXT,
        notes TEXT,
        mfa_hint TEXT,
        last_used_at TIMESTAMP WITH TIME ZONE,
        use_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Named Chrome workflows: multi-step browser actions Claude Chrome can
      -- execute. Each workflow references credentials by name; the run endpoint
      -- assembles a ready-to-paste prompt with the password decrypted.
      CREATE TABLE IF NOT EXISTS chrome_workflows (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        description TEXT,
        target_url TEXT,
        credential_name VARCHAR(100) REFERENCES site_credentials(name) ON DELETE SET NULL,
        steps JSONB DEFAULT '[]',
        expected_output TEXT,
        tags JSONB DEFAULT '[]',
        last_run_at TIMESTAMP WITH TIME ZONE,
        run_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Business Tools catalog — every site / tool Jonathan uses for work.
      -- Seeded from a Chrome bookmark export so it matches the reality of
      -- his day. A tool can optionally be linked to a credential.
      CREATE TABLE IF NOT EXISTS business_tools (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        url TEXT NOT NULL,
        folder_path TEXT,
        favicon_url TEXT,
        description TEXT,
        tags JSONB DEFAULT '[]',
        credential_name VARCHAR(100) REFERENCES site_credentials(name) ON DELETE SET NULL,
        external_workflow_ids JSONB DEFAULT '[]',
        source VARCHAR(50) DEFAULT 'manual',
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (url)
      );

      -- Learning Sources — recurring sources Jonathan consumes content from
      -- (Spotify shows, Audible authors, YouTube channels, blogs, mentors).
      CREATE TABLE IF NOT EXISTS learning_sources (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(30) NOT NULL,             -- spotify_show | audible | youtube | blog | course | mentor | other
        name VARCHAR(255) NOT NULL,
        external_id VARCHAR(255),              -- Spotify show id, Audible ASIN, etc.
        author VARCHAR(255),
        url TEXT,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (kind, external_id)
      );

      -- Learning Log — every consumption event with extracted insights.
      -- raw_notes is whatever was captured (transcript snippet, voice memo
      -- text, manual paste). Claude turns it into structured insights.
      CREATE TABLE IF NOT EXISTS learning_log (
        id SERIAL PRIMARY KEY,
        source_id INTEGER REFERENCES learning_sources(id) ON DELETE SET NULL,
        kind VARCHAR(30) NOT NULL,             -- spotify_episode | audible_chapter | youtube_video | article | voice_memo | conversation
        title VARCHAR(500),
        author VARCHAR(255),
        external_id VARCHAR(255),              -- Spotify episode id, etc.
        url TEXT,
        consumed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        duration_seconds INTEGER,
        raw_notes TEXT,
        summary TEXT,
        key_concepts JSONB DEFAULT '[]',       -- ["concept 1", "concept 2"]
        action_items JSONB DEFAULT '[]',       -- [{ "title", "due_in_days", "category", "notes" }]
        suggested_vocabulary JSONB DEFAULT '[]',
        suggested_memory JSONB DEFAULT '[]',
        applied_action_item_ids JSONB DEFAULT '[]',  -- personal_tasks ids created from action items
        analyzed_at TIMESTAMP WITH TIME ZONE,
        tags JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Activity ledger — every contact touch (call/email/text/meeting/dropby).
      -- Drives the daily lead-gen counters and goals.
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        activity_type VARCHAR(30) NOT NULL,
        contact_name VARCHAR(255),
        contact_phone VARCHAR(50),
        contact_email VARCHAR(255),
        crm_followup_id INTEGER REFERENCES crm_followups(id) ON DELETE SET NULL,
        duration_seconds INTEGER,
        outcome VARCHAR(50),
        notes TEXT,
        source VARCHAR(50) DEFAULT 'manual',
        related_session_id INTEGER,
        related_call_id INTEGER,
        activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Lead-gen goals — flexible per-period targets the dashboard tracks.
      CREATE TABLE IF NOT EXISTS lead_gen_goals (
        id SERIAL PRIMARY KEY,
        goal_type VARCHAR(50) NOT NULL UNIQUE,
        daily_target INTEGER DEFAULT 0,
        weekly_target INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Hour of Power sessions — timed prospecting blocks.
      CREATE TABLE IF NOT EXISTS power_hour_sessions (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP WITH TIME ZONE,
        planned_duration_minutes INTEGER DEFAULT 60,
        status VARCHAR(20) DEFAULT 'active',
        calls_count INTEGER DEFAULT 0,
        connected_count INTEGER DEFAULT 0,
        emails_count INTEGER DEFAULT 0,
        contacts_added INTEGER DEFAULT 0,
        notes TEXT,
        debrief TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Individual calls inside a session.
      CREATE TABLE IF NOT EXISTS power_hour_calls (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES power_hour_sessions(id) ON DELETE CASCADE,
        contact_name VARCHAR(255),
        contact_phone VARCHAR(50),
        contact_email VARCHAR(255),
        fub_person_id VARCHAR(50),
        crm_followup_id INTEGER REFERENCES crm_followups(id) ON DELETE SET NULL,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP WITH TIME ZONE,
        duration_seconds INTEGER,
        transcript TEXT,
        summary TEXT,
        sentiment VARCHAR(20),
        outcome VARCHAR(50),
        jonathan_commitments JSONB DEFAULT '[]',
        client_commitments JSONB DEFAULT '[]',
        follow_ups JSONB DEFAULT '[]',
        coaching_notes TEXT,
        pushed_to_fub_at TIMESTAMP WITH TIME ZONE,
        analyzed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Scheduled jobs — recurring agent tasks, briefings, gap analyses,
      -- weekly reviews, and Claude Chrome workflow reminders.
      -- Time fields are interpreted in America/Toronto.
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        description TEXT,
        kind VARCHAR(50) NOT NULL,                  -- agent_task | briefing | weekly_review | gap_analysis | chrome_workflow
        payload JSONB DEFAULT '{}',
        frequency VARCHAR(20) NOT NULL DEFAULT 'daily',  -- hourly | daily | weekly | monthly
        run_at_hour INTEGER DEFAULT 7,             -- 0-23
        run_at_minute INTEGER DEFAULT 0,           -- 0-59
        run_at_dow INTEGER,                         -- 0-6 (0=Sunday) for weekly
        run_at_dom INTEGER,                         -- 1-31 for monthly
        deliver_via VARCHAR(20) DEFAULT 'dashboard',-- dashboard | email | both
        deliver_to VARCHAR(255),                    -- email override
        enabled BOOLEAN DEFAULT TRUE,
        last_run_at TIMESTAMP WITH TIME ZONE,
        last_status VARCHAR(20),
        last_result JSONB,
        next_run_at TIMESTAMP WITH TIME ZONE,
        run_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Letters of Opinion (LOO / LOV). Written estimates of market value
      -- that Jonathan produces for sellers, lawyers, estate & divorce files.
      CREATE TABLE IF NOT EXISTS letter_opinions (
        id SERIAL PRIMARY KEY,
        seller_form_id INTEGER REFERENCES seller_forms(id) ON DELETE SET NULL,
        client_name VARCHAR(255),
        client_email VARCHAR(255),
        prepared_for VARCHAR(255),
        property_address TEXT NOT NULL,
        city VARCHAR(100),
        postal_code VARCHAR(20),
        property_type VARCHAR(100),
        bedrooms INTEGER,
        bathrooms NUMERIC(3,1),
        square_footage INTEGER,
        lot_size VARCHAR(100),
        year_built INTEGER,
        opinion_low NUMERIC(12,2),
        opinion_mid NUMERIC(12,2),
        opinion_high NUMERIC(12,2),
        comps JSONB DEFAULT '[]',
        rationale TEXT,
        letter_body TEXT,
        prepared_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'draft',
        delivered_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Agent vocabulary: Jonathan's shorthand, abbreviations, industry terms.
      -- Injected into Claude's system prompt so it always understands him.
      CREATE TABLE IF NOT EXISTS agent_vocabulary (
        id SERIAL PRIMARY KEY,
        term VARCHAR(100) NOT NULL,
        expansion TEXT NOT NULL,
        category VARCHAR(50) DEFAULT 'real_estate',
        weight INTEGER DEFAULT 5,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (term)
      );

      -- Agent long-term memory: preferences, client notes, recurring context.
      -- Lightweight — not a full vector store, just high-value snippets Claude
      -- should always consider. Importance weights let us trim to a budget.
      CREATE TABLE IF NOT EXISTS agent_memory (
        id SERIAL PRIMARY KEY,
        key VARCHAR(150) NOT NULL,
        value TEXT NOT NULL,
        category VARCHAR(50) DEFAULT 'preference',
        importance INTEGER DEFAULT 5,
        source VARCHAR(50) DEFAULT 'manual',
        last_used_at TIMESTAMP WITH TIME ZONE,
        use_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (key)
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
      CREATE INDEX IF NOT EXISTS idx_vocab_term ON agent_vocabulary(term);
      CREATE INDEX IF NOT EXISTS idx_memory_key ON agent_memory(key);
      CREATE INDEX IF NOT EXISTS idx_memory_importance ON agent_memory(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_sched_next ON scheduled_tasks(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(activity_date);
      CREATE INDEX IF NOT EXISTS idx_learning_consumed ON learning_log(consumed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_kind ON learning_log(kind);
      CREATE INDEX IF NOT EXISTS idx_learning_source ON learning_log(source_id);
      CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(activity_type);
      CREATE INDEX IF NOT EXISTS idx_power_session_status ON power_hour_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_power_session_started ON power_hour_sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_power_call_session ON power_hour_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_loo_status ON letter_opinions(status);
      CREATE INDEX IF NOT EXISTS idx_loo_prepared ON letter_opinions(prepared_date DESC);
      CREATE INDEX IF NOT EXISTS idx_loo_seller_form ON letter_opinions(seller_form_id);
      CREATE INDEX IF NOT EXISTS idx_cred_name ON site_credentials(name);
      CREATE INDEX IF NOT EXISTS idx_workflow_name ON chrome_workflows(name);
      CREATE INDEX IF NOT EXISTS idx_tools_folder ON business_tools(folder_path);
      CREATE INDEX IF NOT EXISTS idx_tools_archived ON business_tools(archived);
    `);

    // Additive column migrations for existing deploys. Idempotent via
    // IF NOT EXISTS (Postgres 9.6+). New columns added after launch go here
    // so we don't have to rebuild the CREATE TABLE IF NOT EXISTS block every
    // time — fresh deploys pick up the columns from the CREATE TABLE; long-
    // running DBs pick them up here.
    await client.query(`
      ALTER TABLE power_hour_calls ADD COLUMN IF NOT EXISTS fub_person_id VARCHAR(50);
      ALTER TABLE power_hour_calls ADD COLUMN IF NOT EXISTS pushed_to_fub_at TIMESTAMP WITH TIME ZONE;
      CREATE INDEX IF NOT EXISTS idx_power_call_fub_person ON power_hour_calls(fub_person_id);

      CREATE TABLE IF NOT EXISTS nurture_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) UNIQUE NOT NULL,
        purpose VARCHAR(120),               -- e.g. 'market update', 'past-client check-in'
        channel VARCHAR(20) DEFAULT 'note', -- note | task | email_draft
        subject VARCHAR(200),
        body TEXT NOT NULL,
        tags JSONB DEFAULT '[]',
        use_count INTEGER DEFAULT 0,
        last_used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nurture_templates_name ON nurture_templates(name);
    `);

    // Seed a small starter set of nurture templates Jonathan can edit or delete.
    await client.query(`
      INSERT INTO nurture_templates (name, purpose, channel, subject, body, tags) VALUES
      ('Monthly market pulse', 'market update', 'email_draft',
       'Quick Georgian Bay market pulse',
       'Hi there, wanted to send you a quick pulse on the Georgian Bay market this month. If you''ve been keeping an eye on things, prices in Midland and Penetanguishene are holding firm while Wasaga Beach has softened slightly on the ask side. Happy to pull a more specific picture for your neighborhood anytime.\n\nNo rush, just a heads-up.\nJonathan',
       '["market-update","newsletter"]'::jsonb),
      ('Past client check-in', 'past-client touch', 'text',
       null,
       'Hey, been thinking about you — hope everything''s good. Anything on your mind on the real estate side lately? Always happy to catch up.',
       '["past-client","nurture"]'::jsonb),
      ('Referral ask (warm)', 'referral', 'email_draft',
       'Quick favour to ask',
       'Hey, hope all is well with the family. Quick favour to ask — my business grows almost entirely through people like you pointing me at friends who are thinking about moving. Is there anyone in your circle who''s mentioned a change recently? Could be a first-time buyer, someone downsizing, someone just curious. No pressure at all, just wanted to plant the seed. Thanks a ton.',
       '["referral","ask"]'::jsonb),
      ('Open house follow-up (warm)', 'open house', 'note',
       'Open house follow-up',
       'Thanks again for stopping by over the weekend. Wanted to follow up with a couple of homes that fit what you mentioned you were looking for, plus a few comps from the neighborhood so you can see what''s moved recently. If you''d like to see anything in person this week I can make it happen.',
       '["open-house","buyer"]'::jsonb),
      ('Seller LOO offer', 'valuation', 'email_draft',
       'Quick Letter of Opinion for your property',
       'Happy to put together a Letter of Opinion on your home — no obligation, no pressure. I''ll pull the recent comps in your immediate area, walk through what''s sold vs listed, and give you a tight range of what I think the home would move at today. Takes me a few hours; I''ll email the LOO as a PDF once it''s ready. Let me know if that sounds useful.',
       '["seller","LOO","valuation"]'::jsonb)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed real-estate vocabulary Jonathan uses every day. Idempotent.
    await client.query(`
      INSERT INTO agent_vocabulary (term, expansion, category, weight) VALUES
        ('LOO',           'Letter of Opinion — a written estimate of a property''s market value', 'real_estate', 9),
        ('LOV',           'Letter of Opinion of Value — same as LOO', 'real_estate', 9),
        ('FUB',           'Follow-Up Boss, Jonathan''s CRM. Direct API integration is wired — use fub_find_person + fub_add_note / fub_create_task for per-contact actions.', 'tools', 10),
        ('Follow Up Boss','Full name for FUB, Jonathan''s CRM.', 'tools', 8),
        ('MLS',           'Multiple Listing Service — the brokerage database where listings are posted. Jonathan uses Realm on PropTx (OnePoint) as his MLS.', 'real_estate', 8),
        ('Realm',         'Jonathan''s primary MLS platform, accessed through PropTx OnePoint at tools.proptx.ca/onepoint. Logs in via AMP SSO at sso.ampre.ca.', 'tools', 10),
        ('PropTx',        'The TRREB-backed technology platform that hosts Realm and OnePoint. Access at tools.proptx.ca.', 'tools', 9),
        ('OnePoint',      'The PropTx dashboard / landing URL (tools.proptx.ca/onepoint) for Realm MLS and related tools.', 'tools', 9),
        ('TRREB',         'Toronto Regional Real Estate Board — the board Jonathan is a member of. Operates PropTx and Realm.', 'real_estate', 8),
        ('AMP SSO',       'The Ampre single-sign-on gateway at sso.ampre.ca used to authenticate into Realm / PropTx / OnePoint.', 'tools', 7),
        ('GCI',           'Gross Commission Income', 'finance', 8),
        ('firm date',     'the date the deal became firm — all buyer conditions waived', 'real_estate', 7),
        ('conditional',   'offer accepted but still has outstanding conditions (financing, inspection, etc.)', 'real_estate', 7),
        ('SPIS',          'Seller Property Information Statement', 'real_estate', 7),
        ('APS',           'Agreement of Purchase and Sale', 'real_estate', 8),
        ('closing date',  'the date legal title transfers and funds are exchanged', 'real_estate', 7),
        ('buyer rep',     'Buyer Representation Agreement', 'real_estate', 7),
        ('listing agreement', 'the signed contract between Jonathan and a seller to market the property', 'real_estate', 7),
        ('comp',          'a comparable recently sold or listed property used for valuation', 'real_estate', 8),
        ('CMA',           'Comparative Market Analysis — the formal comp analysis for sellers', 'real_estate', 8),
        ('days on market','DOM — how long a property has been actively listed', 'real_estate', 6),
        ('SOGB',          'Southern Georgian Bay', 'geography', 8),
        ('Midland',       'primary service community in Southern Georgian Bay', 'geography', 6),
        ('Penetanguishene','coastal community in SOGB, French-Canadian heritage', 'geography', 6),
        ('Tiny Township', 'cottage + waterfront community along Georgian Bay', 'geography', 6),
        ('Wasaga Beach',  'largest freshwater beach town in SOGB', 'geography', 6),
        ('Tay Township',  'rural + waterfront community in SOGB', 'geography', 6),
        ('TORG',          'The Official Realty Group, Jonathan''s brokerage', 'brand', 10),
        ('open house',    'weekend showing event — Jonathan prefers Saturdays 2-4 pm', 'operations', 6),
        ('price expectation', 'the seller''s own number before CMA-adjusted suggested list', 'real_estate', 6),
        ('waterfront',    'property on or with direct access to Georgian Bay waters — priced at premium', 'real_estate', 7),
        ('cottage',       'seasonal/recreational property, often waterfront', 'real_estate', 6),
        ('Ruuster',       'the IDX feed provider powering the live listings on jonathanwallace.ca', 'tools', 6),
        ('seller form',   'the intake form on the website where prospective sellers submit property details', 'operations', 7),
        ('beta dashboard','the agent command center currently hosted on Railway for Jonathan personal use', 'tools', 5)
      ON CONFLICT (term) DO UPDATE
        SET expansion = EXCLUDED.expansion,
            category = EXCLUDED.category,
            weight = EXCLUDED.weight,
            updated_at = NOW();
    `);

    // Seed agent memory with Jonathan's default preferences + voice rules.
    await client.query(`
      INSERT INTO agent_memory (key, value, category, importance, source) VALUES
        ('preferred_greeting_time',   'Jonathan usually sits down with the dashboard between 6:30am and 7:30am ET',                  'preference', 6, 'seed'),
        ('voice_rules',               'Never use the phrase "won''t last" or other high-pressure real estate cliches. Avoid "dream home" and "must see". Use specific, sensory language instead.', 'voice', 10, 'seed'),
        ('email_signoff',             'Emails from Jonathan end with: "Thanks, Jonathan Wallace — The Official Realty Group, (705) 543-1234".', 'voice', 9, 'seed'),
        ('default_timezone',          'All date/time references default to Eastern Time (America/Toronto) unless Jonathan specifies otherwise.', 'preference', 8, 'seed'),
        ('open_house_default',        'Default open-house slot is Saturday 2-4pm unless Jonathan says otherwise.', 'operations', 6, 'seed'),
        ('market_area',               'Jonathan''s primary market is Southern Georgian Bay: Midland, Penetanguishene, Tiny Township, Tay Township, Wasaga Beach. Collingwood is a secondary area.', 'operations', 9, 'seed'),
        ('brokerage',                 'The Official Realty Group (TORG) is Jonathan''s brokerage.',                                  'brand',      10, 'seed'),
        ('call_me_jonathan',          'Address Jonathan by first name sparingly — at most once per response.',                        'voice',      7, 'seed'),
        ('mls_platform',              'Jonathan''s MLS is Realm, accessed through PropTx OnePoint at https://tools.proptx.ca/onepoint. Logging in triggers AMP SSO (sso.ampre.ca). For MLS-related browser workflows, always use the "realm" credential in the Chrome vault.', 'tools', 10, 'seed'),
        ('fub_integration',           'Follow Up Boss (FUB) is Jonathan''s CRM and is wired up via direct API. Use fub_find_person → fub_add_note / fub_create_task for contact-specific actions. Use fub_create_person for brand new leads. The dashboard CRM card auto-syncs hourly from FUB when the sync schedule is enabled. FUB tasks take precedence over the local crm_followups table.', 'tools', 9, 'seed')
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            category = EXCLUDED.category,
            importance = EXCLUDED.importance,
            updated_at = NOW();
    `);

    // Seed default lead-gen goals (industry standard for an active agent).
    await client.query(`
      INSERT INTO lead_gen_goals (goal_type, daily_target, weekly_target) VALUES
        ('calls',                30,  150),
        ('connected_calls',      10,  50),
        ('emails',               20,  100),
        ('contacts_added',       5,   25),
        ('follow_ups_completed', 15,  75)
      ON CONFLICT (goal_type) DO NOTHING;
    `);

    // Seed a Realm credential placeholder (URL only — password must be entered
    // via the dashboard Settings → Chrome → Credentials editor so it gets
    // AES-256-GCM encrypted at rest). ON CONFLICT DO NOTHING so we never
    // overwrite a password Jonathan has already entered.
    await client.query(`
      INSERT INTO site_credentials (name, site, url, username, notes, mfa_hint)
      VALUES
        ('realm',
         'Realm — PropTx OnePoint (TRREB MLS)',
         'https://tools.proptx.ca/onepoint',
         NULL,
         'Jonathan''s primary MLS. SSO via sso.ampre.ca (AMP). Enter TRREB RECO number as username and your PropTx password via Settings → Chrome → Credentials.',
         'AMP SSO — may prompt for Authenticator 6-digit code on new devices.')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed starter Chrome workflows that target Realm. ON CONFLICT DO NOTHING
    // so Jonathan's edits to these workflows are preserved across deploys.
    await client.query(`
      INSERT INTO chrome_workflows (name, description, target_url, credential_name, steps, expected_output, tags)
      VALUES
        (
          'Realm — Refresh SOGB active listings',
          'Pull a fresh list of active listings across Southern Georgian Bay (Midland, Penetanguishene, Tiny, Tay, Wasaga Beach) for the morning scan.',
          'https://tools.proptx.ca/onepoint',
          'realm',
          '[
             "Log in via AMP SSO using the credential provided.",
             "Open the Realm search / listing portal from OnePoint.",
             "Create a new Residential search filtered by municipality IN (Midland, Penetanguishene, Tiny, Tay, Wasaga Beach) AND status = Active.",
             "Sort by list date descending.",
             "Capture the count, and the top 10 by list price with address, list price, bedrooms, and days on market.",
             "Report the results back to me as a short summary."
           ]'::jsonb,
          'One-paragraph summary + top-10 table (address, price, beds, DOM).',
          '["mls","realm","sogb","morning"]'::jsonb
        ),
        (
          'Realm — Comps for a property address',
          'Pull recent sold comparables for a specific property address. When running, tell Claude which address and radius to use.',
          'https://tools.proptx.ca/onepoint',
          'realm',
          '[
             "Log in via AMP SSO using the credential provided.",
             "Open Realm search.",
             "Search for SOLD comparables within the same community / postal code, closed in the last 120 days, same property type, +/- 25% of subject square footage.",
             "Return up to 10 comps with address, sold price, sold date, bedrooms, bathrooms, square footage, days on market.",
             "Calculate the average $ per sq ft and median sold price."
           ]'::jsonb,
          'Table of up to 10 comps + average $/sqft + median sold price.',
          '["mls","realm","comps","loo"]'::jsonb
        ),
        (
          'Realm — New listings since yesterday',
          'Check Realm for any listings that came on the market in Jonathan''s service area in the last 24 hours. Good for the morning brief.',
          'https://tools.proptx.ca/onepoint',
          'realm',
          '[
             "Log in via AMP SSO using the credential provided.",
             "Open Realm search and filter municipality IN (Midland, Penetanguishene, Tiny, Tay, Wasaga Beach, Collingwood) AND status = Active AND list_date >= yesterday.",
             "Report the total number of new listings.",
             "For each, give me address, price, beds/baths, and list date — grouped by municipality."
           ]'::jsonb,
          'Total count + grouped list by municipality.',
          '["mls","realm","daily","sogb"]'::jsonb
        )
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed a default Follow Up Boss 15-minute sync schedule — DISABLED by
    // default so it doesn't pound the API when no key is configured. Once
    // Jonathan sets fub_api_key (Settings → FUB) he can flip this schedule
    // to enabled from Settings → Scheduled Jobs, or we auto-enable it on
    // his first successful Test Connection (see /api/fub/test handler for
    // a future enhancement).
    await client.query(`
      INSERT INTO scheduled_tasks (name, description, kind, payload, frequency,
        run_at_hour, run_at_minute, run_at_dow, deliver_via, enabled)
      VALUES
        ('FUB — hourly sync',
         'Pulls open tasks + appointments from Follow Up Boss every hour and upserts them into the dashboard CRM card + Calendar. Enable once fub_api_key is configured in Settings.',
         'fub_sync',
         '{}'::jsonb,
         'hourly',
         0, 0, NULL,
         'dashboard',
         FALSE),
        ('FUB — auto-respond to new leads',
         'Every 2 hours, find FUB contacts created in the last 24h with no open tasks and create an Initial Outreach task (Call, due in 24h). Keeps fresh leads from slipping through the cracks.',
         'fub_auto_respond',
         '{"hours": 24}'::jsonb,
         'hourly',
         0, 0, NULL,
         'dashboard',
         FALSE),
        ('FUB — weekly attribution digest',
         'Sends the lead-source attribution report (Claude narrative + top sources + GCI breakdown) every Monday at 7am.',
         'fub_attribution',
         '{"period": "30"}'::jsonb,
         'weekly',
         7, 0, 1,
         'email',
         FALSE)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed default settings (idempotent)
    await client.query(`
      INSERT INTO app_settings (key, value, description)
      VALUES
        ('timezone',               '"America/Toronto"'::jsonb, 'IANA timezone used for date rollups'),
        ('make_webhook_agent',     'null'::jsonb,              'Make.com webhook URL for pushing agent task output'),
        ('make_webhook_marketing', 'null'::jsonb,              'Make.com webhook URL for publishing marketing content'),
        ('make_webhook_crm',       'null'::jsonb,              'Make.com webhook URL for writing back to Follow-Up Boss'),
        ('daily_goal_calories',    '2200'::jsonb,              'Target daily calories'),
        ('daily_goal_protein',     '180'::jsonb,               'Target daily protein (g)'),
        ('workout_week_target',    '5'::jsonb,                 'Target workouts per week'),
        ('dashboard_greeting',     '"Let''s have a great day."'::jsonb, 'Greeting shown at top of dashboard'),
        ('spotify_client_id',      'null'::jsonb,                       'Spotify Web API client ID (from developer.spotify.com app)'),
        ('spotify_client_secret',  'null'::jsonb,                       'Spotify Web API client secret'),
        ('spotify_refresh_token',  'null'::jsonb,                       'Spotify refresh token saved after first OAuth flow'),
        ('fub_api_key',            'null'::jsonb,                       'Follow Up Boss API key (FUB → Admin → API). Jonathan pastes this into dashboard Settings → Integrations. Overridden by FUB_API_KEY env var if set.')
      ON CONFLICT (key) DO NOTHING;
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
