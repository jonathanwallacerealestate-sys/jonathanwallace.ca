const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const pool = require('../db/pool');
const intuition = require('./intuition');

const anthropic = new Anthropic();

// Resolve "today", "tomorrow", "next <weekday>" to YYYY-MM-DD.
// Falls back to returning the input unchanged if it's already a date string.
function resolveDate(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (s === 'today') return d.toISOString().slice(0, 10);
  if (s === 'tomorrow') { d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const m = s.match(/^(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)/i);
  if (m) {
    const target = weekdays.findIndex(w => w.startsWith(m[1].toLowerCase()));
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// Gmail API setup using OAuth2 refresh token
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const SYSTEM_PROMPT = `You are the marketing assistant for Jonathan Wallace, a high-producing real estate agent with The Official Realty Group in Ontario, Canada, primarily serving Georgian Bay communities such as Midland, Penetanguishene, Tiny Township, Wasaga Beach, and Collingwood.

Your job is to turn property information and instructions into high-quality marketing content and actionable outputs.

Always prioritize professionalism, clarity, and persuasive storytelling.
Avoid generic real estate cliches. Avoid exaggeration and avoid phrases like "won't last."

When given property details, generate the following sections clearly labeled:

## MLS LISTING DESCRIPTION
Highlight lifestyle benefits, compelling features first, unique aspects, and location advantages.

## TOP 5 REASONS TO LOVE THIS HOME
Structured list of the five strongest selling points that emotionally connect with buyers.

## INSTAGRAM POST
Engaging caption that promotes the home and builds the agent's brand. Include a call to action and suggest relevant hashtags.

## LISTING VIDEO SCRIPT
Short walkthrough script suitable for a reel. Natural and story-driven.

## GOOGLE BUSINESS POST
Concise update promoting the new listing and encouraging local engagement.

## SELLER UPDATE MESSAGE
Short message the agent can send to the seller about marketing plans.

## OPEN HOUSE PROMOTION
Short promotional message for social media or email inviting buyers to an open house.

Keep formatting clean, easy to copy and paste. Avoid long paragraphs. Be clear and persuasive.

For non-marketing tasks, follow instructions precisely and return structured, actionable results.

You have access to tools that let you take real actions on Jonathan's behalf:

Email & Calendar:
- send_email, create_email_draft
- create_calendar_event, list_calendar_events
- search_google_drive

Dashboard (Jonathan's Agent Command Center):
- create_personal_task, create_crm_followup, log_workout, add_meal, schedule_marketing
- complete_task (marks items as done across any section)
- search_dashboard (find an item before referencing or completing it)

Follow Up Boss (Jonathan's CRM — "FUB"):
- fub_find_person (ALWAYS call first if you only have a name — returns the FUB id)
- fub_add_note      (log a thought / call recap against a contact)
- fub_create_task   (schedule a follow-up tied to a contact)
- fub_complete_task (mark a FUB task done)
- fub_update_stage  (move a contact through the pipeline)
- fub_create_person (register a brand-new lead — open house, referral, inquiry)

Rules for FUB:
- "Add Sarah Mitchell as a lead" → fub_create_person.
- "Log that I just called Tom about the Midland listing" → fub_find_person then fub_add_note.
- "Remind me to follow up with the Smiths next Tuesday" → fub_find_person then fub_create_task.
- If fub_find_person returns needs_disambiguation: true, show the candidates to
  Jonathan and ask which one — don't guess.
- Prefer the FUB tools over create_crm_followup when the contact already lives
  in FUB; only use create_crm_followup for standalone dashboard-only follow-ups.

When Jonathan says things like "Add an errand to pick up dry cleaning tomorrow" or
"Log that I did legs for 45 minutes" or "Mark my call with the Smiths as done",
use the dashboard tools to update his Command Center directly. Always confirm the
action concisely in your response — but don't list SQL IDs, just say what you did
in plain English.`;

// Tool definitions for Claude's native tool_use
const TOOLS = [
  {
    name: 'send_email',
    description: 'Send an email from Jonathan Wallace\'s Gmail account (jonathanwallacerealestate@gmail.com). Use this when instructed to email someone.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_email_draft',
    description: 'Create an email draft in Jonathan\'s Gmail for review before sending. Use this when the user wants to draft but not immediately send.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Create an event on Jonathan\'s Google Calendar. Use this for scheduling showings, open houses, meetings, etc.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g. 2026-04-20T14:00:00-04:00)' },
        end_time: { type: 'string', description: 'End time in ISO 8601 format' },
        description: { type: 'string', description: 'Event description/notes' },
        location: { type: 'string', description: 'Event location/address' }
      },
      required: ['title', 'start_time', 'end_time']
    }
  },
  {
    name: 'list_calendar_events',
    description: 'Search and list events on Jonathan\'s Google Calendar within a date range. Use this to check availability or find scheduled showings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to filter events (optional)' },
        start_date: { type: 'string', description: 'Start of date range in ISO 8601 format' },
        end_date: { type: 'string', description: 'End of date range in ISO 8601 format' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'search_google_drive',
    description: 'Search for files and folders in Jonathan\'s Google Drive. Use this to find listing photos, documents, contracts, etc. Note: This connector requires a Google Drive connection to be configured.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for files/folders (e.g. "123 Main St photos")' }
      },
      required: ['query']
    }
  },

  // -------- Dashboard-native tools (direct Postgres writes) --------
  // These let the agent manage Jonathan's day-to-day dashboard items in
  // response to natural-language instructions like "Add a personal task to
  // call the dry cleaner tomorrow" or "Log that I did legs for 45 minutes."
  {
    name: 'create_personal_task',
    description: 'Create a personal to-do in Jonathan\'s dashboard. Use for errands, family items, admin, learning goals — anything that isn\'t a business/CRM task.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        notes: { type: 'string', description: 'Optional additional details' },
        category: { type: 'string', enum: ['personal','family','errand','admin','learning','health'], description: 'Category' },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: '1=lowest, 5=highest' },
        due_date: { type: 'string', description: 'YYYY-MM-DD or "today"/"tomorrow"' }
      },
      required: ['title']
    }
  },
  {
    name: 'create_crm_followup',
    description: 'Create a CRM follow-up for Jonathan (separate from Follow-Up Boss push — use this for manual additions the agent generates).',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        follow_up_type: { type: 'string', description: 'call, email, text, meeting, showing, etc.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD or "today"/"tomorrow"' },
        notes: { type: 'string' }
      },
      required: ['contact_name', 'follow_up_type']
    }
  },
  {
    name: 'log_workout',
    description: 'Log today\'s workout in the dashboard. Use when Jonathan says he did a workout or wants to plan one.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Workout title (e.g. "Push Day", "5k run")' },
        workout_type: { type: 'string', enum: ['strength','cardio','mobility','hiit','rest','sport'] },
        duration_minutes: { type: 'integer', minimum: 0 },
        intensity: { type: 'string', enum: ['low','moderate','high','max'] },
        calories_burned: { type: 'integer' },
        notes: { type: 'string' },
        completed: { type: 'boolean', description: 'true if already done, false if planning ahead' }
      },
      required: ['workout_type']
    }
  },
  {
    name: 'add_meal',
    description: 'Add a meal to today\'s meal plan with optional macros.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Meal name' },
        meal_type: { type: 'string', enum: ['breakfast','snack_morning','lunch','snack_afternoon','dinner','snack_evening'] },
        calories: { type: 'integer' },
        protein_g: { type: 'integer' },
        carbs_g: { type: 'integer' },
        fat_g: { type: 'integer' },
        prep_notes: { type: 'string' }
      },
      required: ['meal_type']
    }
  },
  {
    name: 'schedule_marketing',
    description: 'Create or schedule a marketing item (post, reel, email blast, ad).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        platform: { type: 'string', enum: ['instagram','facebook','tiktok','linkedin','youtube','email','google','print'] },
        campaign_type: { type: 'string', enum: ['post','reel','story','ad','email_blast','newsletter','video','open_house'] },
        content: { type: 'string', description: 'Caption / body copy' },
        scheduled_for: { type: 'string', description: 'ISO 8601 datetime — when to publish' },
        status: { type: 'string', enum: ['draft','scheduled'] }
      },
      required: ['title']
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a dashboard item as done. Use when Jonathan says "I did X" or "mark X as done". The type parameter tells which table to update.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['personal','crm','workout','meal','email','marketing'] },
        id: { type: 'integer', description: 'ID of the item (from a prior search result)' },
        title_match: { type: 'string', description: 'If no ID known, a fuzzy title substring to match (case-insensitive)' }
      },
      required: ['type']
    }
  },
  {
    name: 'search_dashboard',
    description: 'Search across the dashboard (personal tasks, CRM follow-ups, closings, marketing) by keyword. Use to find an item before referencing or completing it.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for' },
        scope: { type: 'string', enum: ['all','personal','crm','closings','marketing'], description: 'Which table(s) to search' }
      },
      required: ['query']
    }
  },

  // -------- Follow Up Boss tools (direct REST via services/fub.js) --------
  // These let Jonathan say things like "add Sarah Mitchell as a lead, phone
  // 705-555-1234, she's looking in Midland under $800k" or "tell FUB I just
  // had a great 20-min call with the Smith lead" and Claude does it.
  {
    name: 'fub_find_person',
    description: 'Search Follow Up Boss for a person by email, phone, or name. Returns the FUB person id + profile so you can follow up with fub_add_note, fub_create_task, or fub_update_stage. ALWAYS call this first if you only have a name.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email to search for' },
        phone: { type: 'string', description: 'Phone number to search for (digits only or any format)' },
        name:  { type: 'string', description: 'Full name or partial name to search' }
      }
    }
  },
  {
    name: 'fub_add_note',
    description: 'Add a note to a person in Follow Up Boss. Use this for "log what was discussed", "capture a thought about this lead", or after a call/meeting.',
    input_schema: {
      type: 'object',
      properties: {
        person_id: { type: 'integer', description: 'FUB person id (get via fub_find_person first)' },
        subject:   { type: 'string',  description: 'Optional short subject line' },
        body:      { type: 'string',  description: 'The note content (plain text or HTML)' }
      },
      required: ['person_id', 'body']
    }
  },
  {
    name: 'fub_create_task',
    description: 'Create a follow-up task in Follow Up Boss. Use for "remind me to call Sarah Friday", "schedule a check-in", or any forward-looking reminder tied to a specific person.',
    input_schema: {
      type: 'object',
      properties: {
        person_id:  { type: 'integer', description: 'FUB person id' },
        name:       { type: 'string',  description: 'Task title (e.g. "Call about Midland lakefront")' },
        type:       { type: 'string',  enum: ['Call','Email','Text','Meeting','Showing','Other'], description: 'Task type' },
        due_date:   { type: 'string',  description: 'Due date YYYY-MM-DD or "today"/"tomorrow"/"next <weekday>"' },
        description:{ type: 'string',  description: 'Optional longer description' }
      },
      required: ['person_id', 'name']
    }
  },
  {
    name: 'fub_complete_task',
    description: 'Mark a FUB task as completed. Use after you\'ve actually done the thing.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        notes:   { type: 'string', description: 'Optional outcome notes to append' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'fub_update_stage',
    description: 'Update a person\'s stage in Follow Up Boss (e.g. move from "New Lead" to "Nurture", or to "Active Client").',
    input_schema: {
      type: 'object',
      properties: {
        person_id: { type: 'integer' },
        stage:     { type: 'string', description: 'Exact stage name as it appears in FUB (case-sensitive)' }
      },
      required: ['person_id', 'stage']
    }
  },
  {
    name: 'fub_create_person',
    description: 'Create a new lead/contact in Follow Up Boss. Use when meeting someone new at an open house, an online inquiry, or a referral — before any other FUB tool works on them.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name:  { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        source:     { type: 'string', description: 'Where this lead came from (e.g. "Open House", "Website", "Referral")' },
        stage:      { type: 'string', description: 'Initial stage (e.g. "Lead", "New Lead")' },
        note:       { type: 'string', description: 'Optional first-contact note to attach' }
      },
      required: ['first_name']
    }
  }
];

// Make.com webhook for calendar/drive tools only
const CALENDAR_WEBHOOK_URL = 'https://hook.us2.make.com/4bppiq7augsxhykycje1tvw1f4bv5lsr';

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
const MAX_TOOL_ROUNDS = 5;

// Build a raw RFC 2822 email message
function buildRawEmail({ to, subject, body }) {
  const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    body
  ];
  const message = messageParts.join('\r\n');
  return Buffer.from(message).toString('base64url');
}

// Execute email tools directly via Gmail API
async function executeGmailTool(toolName, toolInput) {
  if (toolName === 'send_email') {
    const raw = buildRawEmail(toolInput);
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    return { success: true, messageId: res.data.id, threadId: res.data.threadId };
  }

  if (toolName === 'create_email_draft') {
    const raw = buildRawEmail(toolInput);
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } }
    });
    return { success: true, draftId: res.data.id, messageId: res.data.message.id };
  }

  throw new Error(`Unknown Gmail tool: ${toolName}`);
}

// Execute calendar/drive tools via Make.com webhook
async function executeMakeWebhook(toolName, toolInput) {
  const response = await fetch(CALENDAR_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: toolName, action_params: toolInput })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { error: true, message: `Connector returned ${response.status}: ${errorText}` };
  }

  return await response.json();
}

const EMAIL_TOOLS = ['send_email', 'create_email_draft'];
const DASHBOARD_TOOLS = [
  'create_personal_task', 'create_crm_followup', 'log_workout', 'add_meal',
  'schedule_marketing', 'complete_task', 'search_dashboard'
];

async function executeDashboardTool(toolName, input) {
  switch (toolName) {
    case 'create_personal_task': {
      const due = resolveDate(input.due_date);
      const r = await pool.query(
        `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source)
         VALUES ($1,$2, COALESCE($3,'personal'), COALESCE($4,3), $5, 'claude')
         RETURNING id, title, category, priority, due_date`,
        [input.title, input.notes || null, input.category || null, input.priority || null, due]
      );
      return { success: true, created: 'personal_task', task: r.rows[0] };
    }

    case 'create_crm_followup': {
      const due = resolveDate(input.due_date);
      const r = await pool.query(
        `INSERT INTO crm_followups (contact_name, contact_email, contact_phone,
           follow_up_type, due_date, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,'open')
         RETURNING id, contact_name, follow_up_type, due_date`,
        [input.contact_name, input.contact_email || null, input.contact_phone || null,
         input.follow_up_type, due, input.notes || null]
      );
      return { success: true, created: 'crm_followup', followup: r.rows[0] };
    }

    case 'log_workout': {
      const r = await pool.query(
        `INSERT INTO workouts (workout_date, workout_type, title, duration_minutes,
           intensity, calories_burned, notes, completed)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, COALESCE($7, false))
         RETURNING id, title, workout_type, duration_minutes, completed`,
        [input.workout_type, input.title || null, input.duration_minutes || null,
         input.intensity || null, input.calories_burned || null,
         input.notes || null, input.completed]
      );
      return { success: true, created: 'workout', workout: r.rows[0] };
    }

    case 'add_meal': {
      const r = await pool.query(
        `INSERT INTO meal_plan (meal_date, meal_type, name, calories,
           protein_g, carbs_g, fat_g, prep_notes)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7)
         RETURNING id, meal_type, name, calories`,
        [input.meal_type, input.name || null, input.calories || null,
         input.protein_g || null, input.carbs_g || null, input.fat_g || null,
         input.prep_notes || null]
      );
      return { success: true, created: 'meal', meal: r.rows[0] };
    }

    case 'schedule_marketing': {
      const r = await pool.query(
        `INSERT INTO marketing_items (title, platform, campaign_type, content,
           scheduled_for, status)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'draft'))
         RETURNING id, title, platform, scheduled_for, status`,
        [input.title, input.platform || null, input.campaign_type || null,
         input.content || null, input.scheduled_for || null, input.status]
      );
      return { success: true, created: 'marketing', item: r.rows[0] };
    }

    case 'complete_task': {
      const TABLES = {
        personal: { table: 'personal_tasks', titleCol: 'title', statusField: "status='done', completed_at=NOW()" },
        crm:      { table: 'crm_followups',  titleCol: 'contact_name', statusField: "status='done', completed_at=NOW()" },
        workout:  { table: 'workouts',       titleCol: 'title', statusField: "completed=true" },
        meal:     { table: 'meal_plan',      titleCol: 'name', statusField: "prepped=true" },
        email:    { table: 'flagged_emails', titleCol: 'subject', statusField: "status='handled', handled_at=NOW()" },
        marketing:{ table: 'marketing_items',titleCol: 'title', statusField: "status='posted'" }
      };
      const conf = TABLES[input.type];
      if (!conf) return { error: true, message: 'Unknown type: ' + input.type };
      if (input.id) {
        const r = await pool.query(
          `UPDATE ${conf.table} SET ${conf.statusField} WHERE id = $1 RETURNING id`,
          [input.id]
        );
        if (!r.rows.length) return { error: true, message: 'No row with id ' + input.id };
        return { success: true, completed: input.type, id: r.rows[0].id };
      }
      if (input.title_match) {
        const r = await pool.query(
          `UPDATE ${conf.table} SET ${conf.statusField}
           WHERE ${conf.titleCol} ILIKE $1 RETURNING id, ${conf.titleCol} AS matched`,
          ['%' + input.title_match + '%']
        );
        return { success: true, completed: input.type, matched: r.rows };
      }
      return { error: true, message: 'Provide id or title_match' };
    }

    case 'search_dashboard': {
      const q = '%' + input.query + '%';
      const scope = input.scope || 'all';
      const results = {};
      if (scope === 'all' || scope === 'personal') {
        const r = await pool.query(
          `SELECT id, title, status, due_date FROM personal_tasks
           WHERE title ILIKE $1 OR notes ILIKE $1 ORDER BY created_at DESC LIMIT 10`, [q]
        );
        results.personal = r.rows;
      }
      if (scope === 'all' || scope === 'crm') {
        const r = await pool.query(
          `SELECT id, contact_name, follow_up_type, due_date, status FROM crm_followups
           WHERE contact_name ILIKE $1 OR contact_email ILIKE $1 OR notes ILIKE $1
           ORDER BY COALESCE(due_date,'9999-12-31') ASC LIMIT 10`, [q]
        );
        results.crm = r.rows;
      }
      if (scope === 'all' || scope === 'closings') {
        const r = await pool.query(
          `SELECT id, property_address, client_name, status, closing_date FROM closings
           WHERE property_address ILIKE $1 OR client_name ILIKE $1
           ORDER BY closing_date DESC NULLS LAST LIMIT 10`, [q]
        );
        results.closings = r.rows;
      }
      if (scope === 'all' || scope === 'marketing') {
        const r = await pool.query(
          `SELECT id, title, platform, status, scheduled_for FROM marketing_items
           WHERE title ILIKE $1 OR content ILIKE $1
           ORDER BY created_at DESC LIMIT 10`, [q]
        );
        results.marketing = r.rows;
      }
      return { success: true, query: input.query, results };
    }
  }
  throw new Error('Unhandled dashboard tool: ' + toolName);
}

// -------- Follow Up Boss tool execution --------
const FUB_TOOLS = ['fub_find_person','fub_add_note','fub_create_task','fub_complete_task','fub_update_stage','fub_create_person'];
let _fubClient = null;
function getFub() {
  if (!_fubClient) _fubClient = require('./fub');
  return _fubClient;
}

async function executeFubTool(toolName, input) {
  const fub = getFub();
  switch (toolName) {
    case 'fub_find_person': {
      if (input.email) {
        const p = await fub.findPersonByEmail(input.email);
        if (p) return { success: true, person: p, match_by: 'email' };
      }
      if (input.phone) {
        const p = await fub.findPersonByPhone(input.phone);
        if (p) return { success: true, person: p, match_by: 'phone' };
      }
      if (input.name) {
        const list = await fub.listPeople({ search: input.name, limit: 5 });
        const people = (list && list.people) || [];
        if (people.length === 1) return { success: true, person: people[0], match_by: 'name' };
        if (people.length > 1) return { success: true, candidates: people.map(p => ({ id: p.id, name: p.name, email: p.emails?.[0]?.value, phone: p.phones?.[0]?.value, stage: p.stage })), needs_disambiguation: true };
      }
      return { success: false, message: 'No person found matching the provided identifiers.' };
    }
    case 'fub_add_note': {
      const note = await fub.createNote({
        personId: input.person_id,
        subject: input.subject || null,
        body: input.body,
        isHtml: false
      });
      return { success: true, note_id: note.id, person_id: input.person_id };
    }
    case 'fub_create_task': {
      const due = resolveDate(input.due_date);
      const task = await fub.createTask({
        personId: input.person_id,
        name: input.name,
        type: input.type || 'Call',
        dueDate: due ? new Date(due + 'T09:00:00').toISOString() : undefined,
        description: input.description || null,
        status: 'Active'
      });
      return { success: true, task_id: task.id, due_date: due };
    }
    case 'fub_complete_task': {
      const r = await fub.completeTask(input.task_id, { notes: input.notes });
      return { success: true, task_id: input.task_id, status: r.status };
    }
    case 'fub_update_stage': {
      await fub.updatePerson(input.person_id, { stage: input.stage });
      return { success: true, person_id: input.person_id, stage: input.stage };
    }
    case 'fub_create_person': {
      const body = {
        firstName: input.first_name,
        lastName: input.last_name || null,
        source: input.source || 'Dashboard Agent',
        stage: input.stage || 'Lead'
      };
      if (input.email) body.emails = [{ value: input.email, type: 'primary' }];
      if (input.phone) body.phones = [{ value: input.phone, type: 'mobile' }];
      const person = await fub.createPerson(body);
      if (input.note) {
        try {
          await fub.createNote({ personId: person.id, body: input.note, isHtml: false });
        } catch (e) { /* best effort */ }
      }
      return { success: true, person_id: person.id, name: person.name };
    }
  }
  throw new Error('Unhandled FUB tool: ' + toolName);
}

async function executeToolCall(toolName, toolInput) {
  try {
    if (EMAIL_TOOLS.includes(toolName)) {
      console.log(`[Claude] Routing ${toolName} via Gmail API directly`);
      return await executeGmailTool(toolName, toolInput);
    }
    if (DASHBOARD_TOOLS.includes(toolName)) {
      console.log(`[Claude] Routing ${toolName} via dashboard Postgres`);
      return await executeDashboardTool(toolName, toolInput);
    }
    if (FUB_TOOLS.includes(toolName)) {
      console.log(`[Claude] Routing ${toolName} via Follow Up Boss API`);
      return await executeFubTool(toolName, toolInput);
    }
    console.log(`[Claude] Routing ${toolName} via Make.com calendar gateway`);
    return await executeMakeWebhook(toolName, toolInput);
  } catch (err) {
    console.error(`[Claude] Tool execution error for ${toolName}:`, err.message);
    return { error: true, message: `Tool call failed: ${err.message}` };
  }
}
async function processTask(taskType, instruction, context = {}) {
  const messages = [];
  let userMessage = '';

  switch (taskType) {
    case 'generate_marketing':
      userMessage = `Generate a complete marketing package for this property:\n\n${instruction}`;
      if (context.listing) userMessage += `\n\nExisting listing data:\n${JSON.stringify(context.listing, null, 2)}`;
      break;

    case 'generate_social':
      userMessage = `Create social media content for this:\n\n${instruction}`;
      if (context.platform) userMessage += `\nTarget platform: ${context.platform}`;
      break;

    case 'update_listing':
      userMessage = `Update the following listing information and return the corrected data as JSON:\n\n${instruction}`;
      if (context.current_listing) userMessage += `\nCurrent listing data:\n${JSON.stringify(context.current_listing, null, 2)}`;
      break;

    case 'generate_email':
      userMessage = `Draft a professional real estate email:\n\n${instruction}`;
      if (context.recipient_type) userMessage += `\nRecipient type: ${context.recipient_type}`;
      break;

    case 'analyze_market':
      userMessage = `Provide market analysis insights for the Georgian Bay / Simcoe County real estate market:\n\n${instruction}`;
      break;

    case 'generate_open_house':
      userMessage = `Create open house promotional materials including social media posts, email invite, and a feature sheet outline:\n\n${instruction}`;
      break;

    case 'generate_video_script':
      userMessage = `Write a compelling property walkthrough video script for a listing video or reel:\n\n${instruction}`;
      break;

    case 'process_instruction':
    default:
      userMessage = instruction;
      if (Object.keys(context).length > 0) userMessage += `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`;
      break;
  }

  messages.push({ role: 'user', content: userMessage });

  // Load Jonathan's vocabulary + long-term memory and fold it into the
  // system prompt. Cached for 60s inside the intuition service.
  const intuitionBlock = await intuition.buildContextBlock();
  const composedSystem = intuitionBlock
    ? SYSTEM_PROMPT + '\n\n' + intuitionBlock
    : SYSTEM_PROMPT;

  // Agentic tool-use loop
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = '';
  let modelUsed = '';
  let stopReason = '';
  let toolResults = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let lastError;

    // Retry logic for transient API errors
    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Claude] Retry attempt ${attempt} for ${taskType}`);
          await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
        }

        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: composedSystem,
          tools: TOOLS,
          messages
        });

        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        if (attempt === MAX_RETRIES) {
          throw err;
        }
        console.warn(`[Claude] API error (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    if (!response) throw lastError;

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    modelUsed = response.model;
    stopReason = response.stop_reason;

    // If Claude is done (no more tool calls), extract final text
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      finalContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      break;
    }

    // Handle tool_use blocks
    if (response.stop_reason === 'tool_use') {
      // Add Claude's response (with tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResultBlocks = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[Claude] Tool call: ${block.name}(${JSON.stringify(block.input).substring(0, 120)})`);
          const result = await executeToolCall(block.name, block.input);
          console.log(`[Claude] Tool result: ${JSON.stringify(result).substring(0, 200)}`);

          toolResults.push({ tool: block.name, input: block.input, result });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      // Add tool results to messages for next round
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }

    // Fallback: extract text if stop reason is something else
    finalContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    break;
  }

  return {
    content: finalContent,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens
    },
    model: modelUsed,
    stop_reason: stopReason,
    tool_calls: toolResults.length > 0 ? toolResults : undefined
  };
}

module.exports = { processTask };

