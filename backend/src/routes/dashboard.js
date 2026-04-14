const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  const key = req.query.key;
  if (key !== process.env.API_KEY) {
    return res.status(401).send(`<html><head><title>Login</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}
      form{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,0.1);width:90%;max-width:400px;}
      h2{margin:0 0 1rem;color:#1a1a2e;}input{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px;box-sizing:border-box;margin-bottom:1rem;}
      button{width:100%;padding:12px;background:#1a1a2e;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;}</style></head>
      <body><form method="GET"><h2>Agent Dashboard</h2><input name="key" type="password" placeholder="Enter your API key" autofocus /><button type="submit">Sign In</button></form></body></html>`);
  }

  let tasks = [];
  let stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
  try {
    const taskResult = await pool.query(
      'SELECT id, type, instruction, status, result, error, created_at, completed_at FROM tasks ORDER BY created_at DESC LIMIT 20'
    );
    tasks = taskResult.rows;
    const statsResult = await pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) AS total FROM tasks`);
    stats = statsResult.rows[0];
  } catch (e) {}

  const taskRows = tasks.map(t => {
    const sc = t.status === 'completed' ? '#10b981' : t.status === 'processing' ? '#f59e0b' : t.status === 'failed' ? '#ef4444' : '#6b7280';
    const inst = t.instruction.length > 80 ? t.instruction.substring(0, 80) + '...' : t.instruction;
    const time = new Date(t.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' });
    return '<div class="task" onclick="viewTask(' + t.id + ')"><div class="task-header"><span class="badge" style="background:' + sc + '">' + t.status + '</span><span class="type">' + t.type.replace(/_/g, ' ') + '</span><span class="time">' + time + '</span></div><div class="instruction">' + inst + '</div></div>';
  }).join('');

  res.send(`<!DOCTYPE html><html><head>
    <title>Agent Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js"></script>
    <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,system-ui,sans-serif;background:#f0f2f5;color:#1a1a2e;min-height:100vh;}
    .header{background:#1a1a2e;color:white;padding:1rem 1.5rem;position:sticky;top:0;z-index:10;}
    .header h1{font-size:1.2rem;font-weight:600;}.header small{opacity:0.7;font-size:0.8rem;}
    .stats{display:flex;gap:0.5rem;padding:1rem 1.5rem;overflow-x:auto;}
    .stat{background:white;padding:0.75rem 1rem;border-radius:10px;text-align:center;min-width:70px;box-shadow:0 1px 3px rgba(0,0,0,0.08);}
    .stat .num{font-size:1.5rem;font-weight:700;}.stat .label{font-size:0.7rem;color:#6b7280;text-transform:uppercase;}
    .compose{padding:1rem 1.5rem;}
    .compose textarea{width:100%;padding:14px;border:2px solid #e5e7eb;border-radius:12px;font-size:16px;resize:none;height:100px;font-family:inherit;}
    .compose textarea:focus{outline:none;border-color:#1a1a2e;}
    .compose button{width:100%;padding:14px;background:#1a1a2e;color:white;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;margin-top:0.5rem;}
    .compose button:disabled{background:#9ca3af;}
    .compose .hint{font-size:0.75rem;color:#9ca3af;margin-top:0.5rem;text-align:center;}
    .feedback{padding:0.75rem 1rem;margin:0 1.5rem;border-radius:8px;display:none;font-size:0.9rem;}
    .feedback.success{display:block;background:#d1fae5;color:#065f46;}
    .feedback.error{display:block;background:#fee2e2;color:#991b1b;}
    .tasks{padding:0 1.5rem 2rem;}.tasks h2{font-size:1rem;color:#6b7280;margin-bottom:0.75rem;padding-top:1rem;}
    .task{background:white;padding:1rem;border-radius:10px;margin-bottom:0.5rem;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
    .task:hover{box-shadow:0 2px 8px rgba(0,0,0,0.12);}
    .task-header{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;}
    .badge{color:white;padding:2px 8px;border-radius:20px;font-size:0.7rem;font-weight:600;text-transform:uppercase;}
    .type{font-size:0.8rem;color:#6b7280;}.time{font-size:0.7rem;color:#9ca3af;margin-left:auto;}
    .instruction{font-size:0.9rem;color:#374151;}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;padding:1rem;overflow-y:auto;}
    .modal.active{display:flex;justify-content:center;align-items:flex-start;padding-top:3rem;}
    .modal-content{background:white;border-radius:16px;width:100%;max-width:700px;max-height:85vh;overflow-y:auto;padding:1.5rem;}
    .modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;}
    .modal-header h3{font-size:1.1rem;}
    .modal-actions{display:flex;gap:0.5rem;}
    .btn-copy{padding:6px 14px;background:#f0f2f5;border:1px solid #d1d5db;border-radius:8px;font-size:0.8rem;cursor:pointer;color:#374151;}
    .btn-copy:hover{background:#e5e7eb;}
    .modal-close{background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6b7280;padding:0 4px;}
    .result-body{font-size:0.9rem;line-height:1.7;color:#1a1a2e;}
    .result-body h2{font-size:1.1rem;font-weight:700;color:#1a1a2e;margin:1.5rem 0 0.5rem;padding-bottom:0.3rem;border-bottom:2px solid #e5e7eb;}
    .result-body h3{font-size:1rem;font-weight:600;color:#374151;margin:1rem 0 0.4rem;}
    .result-body p{margin:0.5rem 0;}
    .result-body ul,.result-body ol{margin:0.5rem 0 0.5rem 1.5rem;}
    .result-body li{margin:0.3rem 0;}
    .result-body strong{color:#1a1a2e;}
    .result-body blockquote{border-left:3px solid #1a1a2e;padding-left:1rem;color:#6b7280;margin:0.5rem 0;}
    .result-body hr{border:none;border-top:1px solid #e5e7eb;margin:1rem 0;}
    .result-raw{background:#f8f9fa;padding:1rem;border-radius:8px;white-space:pre-wrap;word-wrap:break-word;font-size:0.85rem;line-height:1.5;max-height:60vh;overflow-y:auto;font-family:monospace;}
    .empty{text-align:center;padding:3rem;color:#9ca3af;}
    </style></head><body>
    <div class="header"><h1>The Official Realty Group</h1><small>Agent Dashboard</small></div>
    <div class="stats">
      <div class="stat"><div class="num">\${stats.total}</div><div class="label">Total</div></div>
      <div class="stat"><div class="num" style="color:#f59e0b">\${stats.pending}</div><div class="label">Pending</div></div>
      <div class="stat"><div class="num" style="color:#3b82f6">\${stats.processing}</div><div class="label">Active</div></div>
      <div class="stat"><div class="num" style="color:#10b981">\${stats.completed}</div><div class="label">Done</div></div>
    </div>
    <div class="compose">
      <textarea id="instruction" placeholder="What do you need? e.g.\\nGenerate marketing for 123 King St, Midland\\nDraft an Instagram post about our new listing\\nWrite an open house promo for Saturday 2-4pm"></textarea>
      <button onclick="submitTask()" id="submitBtn">Send to Agent</button>
      <div class="hint">Your request will be processed by Claude on the server — even if you close this page.</div>
    </div>
    <div class="feedback" id="feedback"></div>
    <div class="tasks"><h2>Recent Tasks</h2>\${taskRows || '<div class="empty">No tasks yet. Send your first instruction above.</div>'}</div>
    <div class="modal" id="modal" onclick="if(event.target===this)closeModal()">
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="modal-title"></h3>
          <div class="modal-actions">
            <button class="btn-copy" onclick="copyResult()">Copy</button>
            <button class="modal-close" onclick="closeModal()">&times;</button>
          </div>
        </div>
        <div id="modal-body" class="result-body"></div>
      </div>
    </div>
    <script>
    const API_KEY='\${process.env.API_KEY}';const BASE=window.location.origin;
    let currentRaw='';
    async function submitTask(){const btn=document.getElementById('submitBtn');const ta=document.getElementById('instruction');const fb=document.getElementById('feedback');const text=ta.value.trim();if(!text)return;btn.disabled=true;btn.textContent='Sending...';fb.className='feedback';try{const res=await fetch(BASE+'/api/tasks/quick',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':API_KEY},body:JSON.stringify({text,source:'dashboard'})});const data=await res.json();if(data.success){fb.className='feedback success';fb.textContent=data.message+' (Task #'+data.task_id+')';ta.value='';setTimeout(()=>location.reload(),2000);}else{fb.className='feedback error';fb.textContent=data.error;}}catch(e){fb.className='feedback error';fb.textContent='Network error.';}btn.disabled=false;btn.textContent='Send to Agent';}
    async function viewTask(id){try{const res=await fetch(BASE+'/api/tasks/'+id,{headers:{'X-API-Key':API_KEY}});const data=await res.json();const t=data.task;document.getElementById('modal-title').textContent=t.type.replace(/_/g,' ')+' — '+t.status;let body='';if(t.result&&t.result.content)body=t.result.content;else if(t.error)body='Error: '+t.error;else if(t.status==='processing')body='Still processing... refresh in a moment.';else body='Waiting in queue...';currentRaw=body;if(typeof marked!=='undefined'){document.getElementById('modal-body').innerHTML=marked.parse(body);document.getElementById('modal-body').className='result-body';}else{document.getElementById('modal-body').textContent=body;document.getElementById('modal-body').className='result-raw';}document.getElementById('modal').classList.add('active');}catch(e){alert('Could not load task.');}}
    function copyResult(){navigator.clipboard.writeText(currentRaw).then(()=>{const btn=document.querySelector('.btn-copy');btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy',2000);});}
    function closeModal(){document.getElementById('modal').classList.remove('active');}
    document.getElementById('instruction').addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='Enter')submitTask();});
    </script></body></html>`);
});

module.exports = router;
