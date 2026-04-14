const pool = require('../db/pool');
const { processTask } = require('./claude');

const POLL_INTERVAL = 10000;
const TASK_TIMEOUT = 120000; // 2 minutes max per task
let isProcessing = false;
let workerInterval = null;
let taskCount = 0;
let errorCount = 0;

async function processNextTask() {
  if (isProcessing) return;
  isProcessing = true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      UPDATE tasks SET status = 'processing', started_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'pending' AND attempts < max_attempts
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ) RETURNING *
    `);

    if (rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const task = rows[0];
    await client.query('COMMIT');

    console.log(`[Worker] Processing task #${task.id} (${task.type}): ${task.instruction.substring(0, 80)}...`);

    try {
      // Wrap processTask with a timeout
      const result = await Promise.race([
        processTask(task.type, task.instruction, task.context || {}),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Task timed out after ' + (TASK_TIMEOUT / 1000) + 's')), TASK_TIMEOUT)
        )
      ]);

      await pool.query(
        `UPDATE tasks SET status = 'completed', result = $1, completed_at = NOW() WHERE id = $2`,
        [JSON.stringify(result), task.id]
      );

      taskCount++;
      const tokens = result.usage.input_tokens + result.usage.output_tokens;
      console.log(`[Worker] Task #${task.id} completed (${tokens} tokens, total processed: ${taskCount})`);

      await runPostProcessing(task, result);

    } catch (err) {
      errorCount++;
      console.error(`[Worker] Task #${task.id} failed (attempt ${task.attempts + 1}/${task.max_attempts}):`, err.message);

      const newStatus = task.attempts + 1 >= task.max_attempts ? 'failed' : 'pending';

      await pool.query(
        `UPDATE tasks SET status = $1, error = $2, context = jsonb_set(COALESCE(context, '{}')::jsonb, '{last_error_at}', to_jsonb(NOW()::text)) WHERE id = $3`,
        [newStatus, err.message, task.id]
      );

      if (newStatus === 'failed') {
        console.error(`[Worker] Task #${task.id} permanently failed after ${task.max_attempts} attempts`);
      } else {
        console.log(`[Worker] Task #${task.id} will retry`);
      }
    }

  } catch (err) {
    console.error('[Worker] Queue processing error:', err.message);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
  } finally {
    client.release();
    isProcessing = false;
  }
}

async function runPostProcessing(task, result) {
  try {
    switch (task.type) {
      case 'generate_marketing': {
        if (task.context?.listing_id) {
          await pool.query(
            `UPDATE listings SET description = $1, updated_at = NOW() WHERE id = $2`,
            [result.content, task.context.listing_id]
          );
          console.log(`[Worker] Updated listing #${task.context.listing_id} with marketing content`);
        }
        break;
      }
      case 'update_listing': {
        if (task.context?.listing_id) {
          try {
            const jsonMatch = result.content.match(/\`\`\`json\n?([\s\S]*?)\n?\`\`\`/);
            if (jsonMatch) {
              const listingData = JSON.parse(jsonMatch[1]);
              const fields = [];
              const values = [];
              let idx = 1;
              for (const [key, value] of Object.entries(listingData)) {
                if (['address','city','price','bedrooms','bathrooms','square_footage','lot_size','property_type','description','features','images','status'].includes(key)) {
                  fields.push(`${key} = $${idx++}`);
                  values.push(typeof value === 'object' ? JSON.stringify(value) : value);
                }
              }
              if (fields.length > 0) {
                fields.push('updated_at = NOW()');
                values.push(task.context.listing_id);
                await pool.query(`UPDATE listings SET ${fields.join(', ')} WHERE id = $${idx}`, values);
                console.log(`[Worker] Auto-updated listing #${task.context.listing_id}`);
              }
            }
          } catch (parseErr) {
            console.log('[Worker] Could not auto-parse listing update, stored as result only');
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[Worker] Post-processing error for task #${task.id}:`, err.message);
  }
}

function startWorker() {
  console.log(`[Worker] Starting task worker (polling every ${POLL_INTERVAL / 1000}s)`);
  workerInterval = setInterval(processNextTask, POLL_INTERVAL);
  processNextTask();

  // Log health stats every 5 minutes
  setInterval(() => {
    console.log(`[Worker] Health: ${taskCount} tasks completed, ${errorCount} errors`);
  }, 300000);
}

function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[Worker] Task worker stopped');
  }
}

module.exports = { startWorker, stopWorker };
