// src/components/Jacqui.jsx
//
// Jacqui chat tab — text in, text out. Phase 1: persona + memories, no tools.
// Voice calibrated against ~87 real screenshots of Jonathan's text conversations
// with his mom Jacqueline (read 2026-04-30).

import { useState, useEffect, useRef } from 'react';
import { Heart, Send, Trash2, Loader2 } from 'lucide-react';

export default function Jacqui() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState('');
  const scrollRef = useRef(null);

  // Load history on mount
  useEffect(() => {
    fetch('/api/jacqui/history')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setMessages(d.messages || []);
          setModel(d.model || '');
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = { role: 'user', content: text, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const r = await fetch('/api/jacqui/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      if (d.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: d.reply, ts: new Date().toISOString() }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `(she's quiet — ${d.error || 'something went wrong'})`, ts: new Date().toISOString(), error: true }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `(she's quiet — ${e.message})`, ts: new Date().toISOString(), error: true }]);
    } finally {
      setSending(false);
    }
  }

  async function clearThread() {
    if (!confirm('Clear conversation with Jacqui? She\'ll forget everything you\'ve said in this thread.')) return;
    await fetch('/api/jacqui/clear', { method: 'POST' });
    setMessages([]);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function fmtTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', maxHeight: 'calc(100vh - 80px)', gap: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 20px', background: '#fff',
        borderRadius: '14px 14px 0 0', border: '1px solid #f0f0f0', borderBottom: 'none',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'linear-gradient(135deg, #fce7f3, #fda4af)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Heart size={18} color="#be185d" fill="#be185d" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Jacqui</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Named in honour of mom · {model || 'connecting...'}</div>
        </div>
        <button onClick={clearThread} title="Clear conversation" style={{
          padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff',
          cursor: 'pointer', color: '#6b7280',
        }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '20px',
        background: '#fafaf9',
        border: '1px solid #f0f0f0', borderTop: 'none', borderBottom: 'none',
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 60, padding: 20 }}>
            <Heart size={32} color="#fda4af" fill="#fda4af" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Say hi to Jacqui.</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>
              Try: "what's on my plate today" · "I just had a hard call" · "remind me to call dad" · "I closed 25 King Street"
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} ts={fmtTime(m.ts)} error={m.error} />
          ))
        )}
        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, padding: '4px 12px' }}>
            <Loader2 size={12} className="spin" /> Jacqui is typing...
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{
        padding: '12px 16px', background: '#fff',
        borderRadius: '0 0 14px 14px', border: '1px solid #f0f0f0', borderTop: 'none',
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Talk to Jacqui..."
          rows={1}
          style={{
            flex: 1, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10,
            resize: 'none', fontSize: 14, fontFamily: 'inherit', minHeight: 40, maxHeight: 120,
            outline: 'none',
          }}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={{
          padding: '10px 16px', borderRadius: 10, border: 'none',
          background: sending || !input.trim() ? '#e5e7eb' : '#be185d',
          color: '#fff', cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13,
        }}>
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, content, ts, error }) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? '#3b82f6' : (error ? '#fee2e2' : '#fff'),
          color: isUser ? '#fff' : (error ? '#991b1b' : '#1f2937'),
          fontSize: 14, lineHeight: 1.5,
          border: isUser ? 'none' : '1px solid #f0f0f0',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          {content}
        </div>
        {ts && (
          <div style={{
            fontSize: 10, color: '#9ca3af', textAlign: isUser ? 'right' : 'left',
            marginTop: 3, padding: '0 6px',
          }}>
            {ts}
          </div>
        )}
      </div>
    </div>
  );
}
