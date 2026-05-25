// src/components/Jacqui.jsx
//
// Jacqui chat tab — text + voice + document teaching, all in one tab.
//
// Voice calibrated against ~87 real screenshots of Jonathan's text conversations
// with his mom Jacqueline (read 2026-04-30).
//
// CHANGES IN THIS VERSION (2026-05-25):
//   • Mic button — browser-native webkitSpeechRecognition. No server round-trip,
//     no audio leaves the device. Transcript drops into the composer; Jonathan
//     reviews/edits before sending. Tap mic to start, tap again to stop.
//   • Paperclip button — drop a PDF/image/text doc on her. Fires the existing
//     /api/jacqui/memory/document endpoint which extracts → summarizes → writes
//     memory entries tagged source=<filename>. Shows "📚 learned" confirm.
//   • Memory ack chips — when she auto-writes to memory (handoff-style cues
//     in your message like "remember that…" or "from now on…"), she returns
//     `memory_writes` in the chat response; we show a little 📝 AUTO chip
//     so Jonathan can audit what she captured.
//   • Mobile-first composer — buttons wrap to a thumb-friendly row on narrow
//     viewports. Safe-area-inset-bottom respected when used as installed PWA.

import { useState, useEffect, useRef } from 'react';
import { Heart, Send, Trash2, Loader2, Mic, MicOff, Paperclip, BookOpen } from 'lucide-react';

export default function Jacqui() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState('');
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [micSupported, setMicSupported] = useState(true);
  const scrollRef = useRef(null);
  const recogRef = useRef(null);
  const fileInputRef = useRef(null);

  // Detect mic support on mount
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicSupported(false);
      return;
    }
    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-CA';
    recog.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) {
        setInput(prev => (prev ? prev + ' ' : '') + finalText.trim());
      } else if (interimText) {
        // Show interim in a status hint only (avoid stomping user edits)
        setUploadMsg(`Listening: "${interimText.trim().slice(0, 60)}${interimText.length > 60 ? '…' : ''}"`);
      }
    };
    recog.onend = () => {
      setListening(false);
      setUploadMsg('');
    };
    recog.onerror = (e) => {
      setListening(false);
      setUploadMsg(`Mic error: ${e.error || 'unknown'} (check Settings → Safari → Microphone)`);
      setTimeout(() => setUploadMsg(''), 5000);
    };
    recogRef.current = recog;
    return () => { try { recog.abort(); } catch {} };
  }, []);

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
    // Stop listening if active — sending implies the dictation is done.
    if (listening) {
      try { recogRef.current?.stop(); } catch {}
      setListening(false);
    }
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
        const msg = {
          role: 'assistant',
          content: d.reply,
          ts: new Date().toISOString(),
        };
        // Surface memory writes from tool_calls so Jonathan sees what was logged.
        const memCalls = (d.tool_calls || []).filter(
          c => c.name === 'remember_this' && c.result && c.result.ok
        );
        if (memCalls.length) {
          msg.memoryWrites = memCalls.map(c => ({
            kind: c.input?.kind || 'note',
            summary: c.input?.summary || c.input?.body?.slice(0, 80) || '',
          }));
        }
        setMessages(prev => [...prev, msg]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `(she's quiet — ${d.error || 'something went wrong'})`, ts: new Date().toISOString(), error: true }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `(she's quiet — ${e.message})`, ts: new Date().toISOString(), error: true }]);
    } finally {
      setSending(false);
    }
  }

  function toggleMic() {
    if (!recogRef.current) return;
    if (listening) {
      try { recogRef.current.stop(); } catch {}
      setListening(false);
    } else {
      try {
        recogRef.current.start();
        setListening(true);
        setUploadMsg('Listening… (tap mic again to stop)');
        if (navigator.vibrate) try { navigator.vibrate(10); } catch {}
      } catch (e) {
        setUploadMsg(`Mic failed to start: ${e.message}`);
      }
    }
  }

  async function uploadDoc(file) {
    if (!file) return;
    // Route audio files (.m4a/.mp3/.wav/.webm/etc.) to /api/jacqui/memory/audio
    // for Whisper transcription. Everything else (PDF/text/image) goes to
    // /api/jacqui/memory/document for the existing pdf-parse path.
    const isAudio =
      (file.type || '').startsWith('audio/') ||
      /\.(m4a|mp3|mp4|wav|webm|aac|ogg|flac)$/i.test(file.name || '');

    setUploading(true);
    setUploadMsg(
      isAudio
        ? `🎧 Transcribing "${file.name}" — this can take 30–90s for long recordings…`
        : `Uploading "${file.name}"…`
    );

    const endpoint = isAudio ? '/api/jacqui/memory/audio' : '/api/jacqui/memory/document';

    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(endpoint, { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success || d.ok) {
        const summary = d.summary || d.document?.summary || '';
        const docId = d.doc_id || d.document?.id || null;
        const duration = d.duration ? ` (${Math.round(d.duration / 60)} min)` : '';
        const decomposeUrl = d.decompose_url || (docId ? `/api/jacqui/memory/documents/${docId}/decompose` : null);
        setUploadMsg('');
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: isAudio
              ? `🎧 I transcribed "${file.name}"${duration}. ${summary ? '— ' + summary : ''}\n\nReady to extract structured knowledge — say "decompose it" to pull procedures, decisions, and lessons into my memory.`
              : `📚 I read "${file.name}". ${summary ? '— ' + summary : ''}`,
            ts: new Date().toISOString(),
            taught: true,
            doc_id: docId,
            decompose_url: decomposeUrl,
          },
        ]);
      } else {
        setUploadMsg(`Upload failed: ${d.error || 'unknown error'}`);
        setTimeout(() => setUploadMsg(''), 6000);
      }
    } catch (e) {
      setUploadMsg(`Upload failed: ${e.message}`);
      setTimeout(() => setUploadMsg(''), 6000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Named in honour of mom · {model || 'connecting...'} · talk, dictate, or teach her with a doc
          </div>
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
              Try: "what's on my plate today" · "I just had a hard call" · "remember that Edmund Rucels sold 112 Farlain to Jorun" · drop a feature sheet PDF to teach her about a listing
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Bubble
              key={i}
              role={m.role}
              content={m.content}
              ts={fmtTime(m.ts)}
              error={m.error}
              taught={m.taught}
              memoryWrites={m.memoryWrites}
            />
          ))
        )}
        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, padding: '4px 12px' }}>
            <Loader2 size={12} className="spin" /> Jacqui is typing...
          </div>
        )}
      </div>

      {/* Status strip (mic / upload feedback) */}
      {uploadMsg && (
        <div style={{
          padding: '6px 16px', fontSize: 11, color: '#6b7280',
          background: '#fef3c7', borderLeft: '3px solid #f59e0b',
          borderRight: '1px solid #f0f0f0', borderLeftColor: listening ? '#dc2626' : '#f59e0b',
        }}>
          {uploadMsg}
        </div>
      )}

      {/* Composer */}
      <div style={{
        padding: '12px 16px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        background: '#fff',
        borderRadius: '0 0 14px 14px', border: '1px solid #f0f0f0', borderTop: 'none',
        display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
      }}>
        {/* Hidden file input — paperclip triggers it */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.m4a,.mp3,.mp4,.wav,.webm,.aac,.ogg,audio/*,application/pdf,text/*,image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={e => uploadDoc(e.target.files?.[0])}
        />
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={listening ? 'Listening — speak now…' : 'Talk to Jacqui · 🎤 dictate · 📎 drop a PDF, image, or voice memo for her to learn from…'}
          rows={1}
          style={{
            flex: 1, minWidth: 180,
            padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10,
            resize: 'none', fontSize: 14, fontFamily: 'inherit', minHeight: 40, maxHeight: 120,
            outline: 'none',
          }}
        />
        {/* Paperclip — upload doc */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Teach Jacqui with a doc, image, or voice memo (PDF, m4a, mp3, wav, etc.)"
          style={{
            padding: '10px 12px', borderRadius: 10,
            border: '1px solid #e5e7eb', background: '#fff',
            color: uploading ? '#9ca3af' : '#6b7280',
            cursor: uploading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {uploading ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}
        </button>
        {/* Mic */}
        {micSupported && (
          <button
            onClick={toggleMic}
            title={listening ? 'Stop dictation' : 'Start dictation (in-browser)'}
            style={{
              padding: '10px 12px', borderRadius: 10,
              border: '1px solid ' + (listening ? '#dc2626' : '#e5e7eb'),
              background: listening ? '#fee2e2' : '#fff',
              color: listening ? '#dc2626' : '#6b7280',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {listening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        )}
        {/* Send */}
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

function Bubble({ role, content, ts, error, taught, memoryWrites }) {
  const isUser = role === 'user';
  const isTaught = taught && !isUser;
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? '#3b82f6'
            : (error ? '#fee2e2'
            : (isTaught ? '#ecfeff' : '#fff')),
          color: isUser ? '#fff'
            : (error ? '#991b1b'
            : (isTaught ? '#0e7490' : '#1f2937')),
          fontSize: 14, lineHeight: 1.5,
          border: isUser ? 'none'
            : (isTaught ? '1px solid #a5f3fc' : '1px solid #f0f0f0'),
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          {content}
          {memoryWrites && memoryWrites.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {memoryWrites.map((w, i) => (
                <span key={i} title={w.summary} style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  padding: '2px 6px', borderRadius: 4,
                  background: '#fef3c7', color: '#92400e',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}>
                  <BookOpen size={10} />
                  AUTO · {w.kind.toUpperCase()}
                </span>
              ))}
            </div>
          )}
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
