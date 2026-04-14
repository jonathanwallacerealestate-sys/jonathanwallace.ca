const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

const VALID_TYPES = [
  'generate_marketing',
  'generate_social',
  'generate_email',
  'update_listing',
  'analyze_market',
  'process_instruction'
];

// POST /api/tasks — Submit a new task
router.post('/', requireApiKey, async (req, res) => {
  try {
    const { type, instruction, context, priority, source } = req.body;
    if (!instruction || instruction.trim().length === 0) {
      return res.status(400).json({ error: 'Missing required field: instruction' });
    }
    const taskType = type || 'process_instruction';
    if (!VALID_TYPES.includes(taskType)) {
      return res.status(400).json({ error: 'Invalid task type: ' + taskType, valid_types: VALID_TYPES });
    }
    const result = await pool.query(
      `INSERT INTO tasks (type, instruction, context, priority, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, status, priority, created_at`,
      [taskType, instruction.trim(), JSON.stringify(context || {}),
       Math.min(Math.max(parseInt(priority) || 5, 1), 10), source || 'api']
    );
    const task = result.rows[0];
    res.status(201).json({
      success: true,
      task: { ...task, check_status: '/api/tasks/' + task.id },
      message: 'Task queued. The agent will process it shortly.'
    });
  } catch (err) {
    console.error('Task creation error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// POST /api/tasks/quick — Shortcut for iPhone, Make.com, SMS
router.post('/quick', requireApiKey, async (req, res) => {
  try {
    let instruction = '';
    let source = 'quick';
    if (typeof req.body === 'string') {
      instruction = req.body;
    } else if (req.body.text) {
      instruction = req.body.text;
      source = req.body.source || 'quick';
    } else if (req.body.instruction) {
      instruction = req.body.instruction;
      source = req.body.source || 'quick';
    } else if (req.body.message) {
      instruction = req.body.message;
      source = req.body.source || 'quick';
    }
    if (!instruction || instruction.trim().length === 0) {
      return res.status(400).json({ error: 'Send a text instruction' });
    }
    const taskType = detectTaskType(instruction);
    const result = await pool.query(
      `INSERT INTO tasks (type, instruction, context, priority, source)
       VALUES ($1, $2, '{}', 5, $3) RETURNING id, type, status, created_at`,
      [taskType, instruction.trim(), source]
    );
    const task = result.rows[0];
    res.status(201).json({
      success: true,
      task_id: task.id,
      type: task.type,
      message: 'Got it. Processing your ' + task.type.replace(/_/g, ' ') + ' request now.',
      check_status: '/api/tasks/' + task.id
    });
  } catch (err) {
    console.error('Quick task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// GET /api/tasks/:id — Check task status
router.get('/:id', requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, instruction, status, priority, result, error,
              attempts, source, created_at, started_at, completed_at
       FROM tasks WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    let processing_time = null;
    if (task.started_at && task.completed_at) {
      processing_time = Math.round((new Date(task.completed_at) - new Date(task.started_at)) / 1000);
    }
    res.json({ task: { ...task, processing_time_seconds: processing_time } });
  } catch (err) {
    console.error('Task fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve task' });
  }
});

// GET /api/tasks — List recent tasks
router.get('/', requireApiKey, async (req, res) => {
  try {
    const { status, type, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 20, 100);
    let query = 'SELECT id, type, instruction, status, priority, source, created_at, completed_at FROM tasks WHERE 1=1';
    const params = [];
    let idx = 1;
    if (status) { query += ' AND status = $' + idx++; params.push(status); }
    if (type) { query += ' AND type = $' + idx++; params.push(type); }
    query += ' ORDER BY created_at DESC LIMIT $' + idx;
    params.push(limit);
    const { rows } = await pool.query(query, params);
    const stats = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'processing') AS processing,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed,
             COUNT(*) AS total FROM tasks`);
    res.json({ tasks: rows, queue: stats.rows[0] });
  } catch (err) {
    console.error('Task list error:', err);
    res.status(500).json({ error: 'Failed to retrieve tasks' });
  }
});

function detectTaskType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('marketing') || lower.includes('listing description') || lower.includes('mls') ||
      (lower.includes('new listing') && lower.includes('bed'))) return 'generate_marketing';
  if (lower.includes('instagram') || lower.includes('social') || lower.includes('facebook') ||
      lower.includes('post about')) return 'generate_social';
  if (lower.includes('email') || lower.includes('newsletter') || lower.includes('draft a message'))
    return 'generate_email';
  if (lower.includes('update') && (lower.includes('listing') || lower.includes('price')))
    return 'update_listing';
  if (lower.includes('market') && (lower.includes('analysis') || lower.includes('report')))
    return 'analyze_market';
  return 'process_instruction';
}

module.exports = router;
