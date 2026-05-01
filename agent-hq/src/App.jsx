import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import {
  Mail, Users, Calendar, Target, DollarSign, User, Dumbbell,
  UtensilsCrossed, Megaphone, BookOpen, Briefcase, Clock, Settings, Bell,
  Search, ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight, Phone,
  MapPin, CheckCircle2, FileText, Play, Pause, Square, PhoneCall, PhoneOff,
  UserCheck, CalendarPlus, Zap, MessageCircle, X, Sparkles, Timer, Star,
  Send, Archive, Reply, AlertTriangle, Coffee, Sun, Flame, Snowflake,
  UserPlus, RotateCcw, Eye, EyeOff, ChevronUp, MoreHorizontal, Inbox,
  Flag, Trash2, PenLine, Check, ExternalLink, RefreshCw, Copy,
  GripVertical, ClipboardList, Home, Plus, Save, Loader2, Trash, RotateCw,
  TrendingUp, BarChart3, MessageSquare, Heart, UploadCloud,
} from "lucide-react";

// Listing form option lists (extracted 2026-04-24 — see src/config/)
import {
  HEATING_OPTIONS, AC_OPTIONS, APPLIANCE_OPTIONS, INCLUSION_OPTIONS,
  FOUNDATION_TYPES, ROOF_TYPES, STYLE_OPTIONS, PROPERTY_TYPES,
  BASEMENT_TYPES, WATER_SOURCES, SEWER_TYPES, GARAGE_TYPES, FLOORING_TYPES,
  ROOM_DETAIL_BASE, getRoomDetailOptions,
} from './config/listing-form-options.js';

// Listing-form-shaped form helpers (extracted 2026-04-24 — see src/components/)
import {
  defaultFormData, ChipSelect, FormField, FormSection,
} from './components/form-helpers.jsx';

// Shared form-shaped style constants (extracted 2026-04-24)
import {
  inputStyle, selectStyle, textareaStyle, gridStyle,
} from './components/form-styles.js';

// The full Listing Form component (extracted 2026-04-24 — see src/components/)
import ListingForm from './components/ListingForm.jsx';
import Jacqui from './components/Jacqui.jsx';

// ─────────────────────────────────────────────
// DATA: FUB SMART CALL LIST (live from Follow Up Boss)
// ─────────────────────────────────────────────
// Fallback used while FUB loads or if API key isn't configured
const dailyCallListFallback = [];

// Hook to fetch live call list from FUB
function useFubCallList() {
  const [callList, setCallList] = useState(() => {
    try {
      const cached = localStorage.getItem('agenthq-fub-calllist');
      if (cached) {
        const parsed = JSON.parse(cached);
        // Only use cache from today
        const todayKey = new Date().toISOString().slice(0, 10);
        if (parsed.dateKey === todayKey && parsed.list) return parsed.list;
      }
    } catch {}
    return dailyCallListFallback;
  });
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [totalContacts, setTotalContacts] = useState(0);
  const [generatedAt, setGeneratedAt] = useState(null);

  const fetchCallList = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const url = forceRefresh ? '/api/fub/calllist?refresh=true' : '/api/fub/calllist';
      const res = await fetch(url);
      const data = await res.json();
      if (data.callList && data.callList.length > 0) {
        setCallList(data.callList);
        setConnected(data.connected !== false);
        setTotalContacts(data.totalContacts || data.callList.length);
        setGeneratedAt(data.generatedAt || null);
        // Cache locally
        try {
          localStorage.setItem('agenthq-fub-calllist', JSON.stringify({
            list: data.callList,
            dateKey: new Date().toISOString().slice(0, 10),
          }));
        } catch {}
      } else if (data.connected === false) {
        setConnected(false);
      }
    } catch (err) {
      console.error('[FUB] Failed to fetch call list:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCallList(); }, []);

  return { callList, loading, connected, totalContacts, generatedAt, refresh: () => fetchCallList(true) };
}

// FUB call list context — shared across Dashboard, HourOfPowerBar, MorningBriefing, CallListSection
const FubContext = createContext({ callList: [], loading: true, connected: false, totalContacts: 0, generatedAt: null, refresh: () => {} });
function useFubContext() { return useContext(FubContext); }

// ─────────────────────────────────────────────
// DATA: EMAIL TRIAGE (LIVE — EA Engine from Gmail + FUB)
// ─────────────────────────────────────────────
// No fallback data — show "Reconnect to Google" when disconnected
const emailInboxFallback = [];

// Hook to fetch live EA email triage
function useEaEmailTriage() {
  const [threads, setThreads] = useState([]);
  const [counts, setCounts] = useState({ awaiting_you: 0, draft_ready: 0, awaiting_them: 0, closed: 0, snoozed: 0 });
  const [status, setStatus] = useState('loading');
  const [lastSweep, setLastSweep] = useState(null);
  const [fubSentTracked, setFubSentTracked] = useState(0);

  const fetchTriage = async () => {
    try {
      const res = await fetch('/api/ea/triage');
      const data = await res.json();
      if (data.threads && data.threads.length > 0) {
        setThreads(data.threads);
        setCounts(data.counts || { awaiting_you: 0, draft_ready: 0, awaiting_them: 0, closed: 0, snoozed: 0 });
        setLastSweep(data.lastSweep);
        setFubSentTracked(data.fubSentTracked || 0);
        setStatus(data.status || 'ok');
      } else if (data.status === 'disconnected') {
        setStatus('disconnected');
      } else {
        setStatus(data.status || 'ok');
      }
    } catch (err) {
      console.error('[EA] Triage fetch error:', err);
      setStatus('error');
    }
  };

  const updateThreadState = async (threadId, newState, snoozeUntil) => {
    try {
      await fetch(`/api/ea/thread/${threadId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState, snoozeUntil }),
      });
      setThreads(prev => prev.map(t =>
        t.threadId === threadId ? { ...t, state: newState } : t
      ));
      setCounts(prev => {
        const next = { ...prev };
        // Decrement old state, increment new
        const oldThread = threads.find(t => t.threadId === threadId);
        if (oldThread && next[oldThread.state] !== undefined) next[oldThread.state]--;
        if (next[newState] !== undefined) next[newState]++;
        return next;
      });
    } catch {}
  };

  const deleteThread = async (threadId) => {
    try {
      // Optimistically remove from UI
      const oldThread = threads.find(t => t.threadId === threadId);
      setThreads(prev => prev.filter(t => t.threadId !== threadId));
      if (oldThread) {
        setCounts(prev => {
          const next = { ...prev };
          if (next[oldThread.state] !== undefined) next[oldThread.state]--;
          return next;
        });
      }
      // Trash in Gmail + remove from EA cache
      await fetch(`/api/ea/thread/${threadId}`, { method: 'DELETE' });
    } catch {}
  };

  useEffect(() => {
    fetchTriage();
    const interval = setInterval(fetchTriage, 5 * 60 * 1000); // Sweep every 5 min
    return () => clearInterval(interval);
  }, []);

  return { threads, counts, status, lastSweep, fubSentTracked, refresh: fetchTriage, updateThreadState, deleteThread };
}

// Hook for Claude Stuck ticker
function useEaStuckTicker() {
  const [questions, setQuestions] = useState([]);

  const fetchStuck = async () => {
    try {
      const res = await fetch('/api/ea/stuck');
      const data = await res.json();
      setQuestions(data.questions || []);
    } catch {}
  };

  const resolveQuestion = async (id, answer) => {
    try {
      await fetch(`/api/ea/stuck/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      setQuestions(prev => prev.filter(q => q.id !== id));
    } catch {}
  };

  const dismissQuestion = async (id) => {
    try {
      await fetch(`/api/ea/stuck/${id}/dismiss`, { method: 'POST' });
      setQuestions(prev => prev.filter(q => q.id !== id));
    } catch {}
  };

  useEffect(() => {
    fetchStuck();
    const interval = setInterval(fetchStuck, 30 * 1000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return { questions, refresh: fetchStuck, resolveQuestion, dismissQuestion };
}

// Shared context for EA data
const EaContext = createContext(null);

// ─────────────────────────────────────────────
// DATA: CALENDAR (Google Calendar — connection needs refresh)
// ─────────────────────────────────────────────
// NOTE: Google Calendar MCP integration needs reconnection.
// Showing only BrokerBay-confirmed events as LIVE data for now.
// Calendar events — populated from live Google Calendar API
const todayCalendar = [];
const gcalConnectionStatus = { connected: false, reason: "Google Calendar integration needs refresh — reconnect to pull full calendar." };

// ─────────────────────────────────────────────
// DATA: BROKERBAY SHOWINGS (LIVE — parsed from Gmail)
// ─────────────────────────────────────────────
// BrokerBay showings — populated from live Gmail parsing when connected
// BrokerBay showings — loaded live from /api/gmail/brokerbay
// Shared hook so multiple components can access the same data
function useBrokerBayShowings() {
  const [data, setData] = useState({ showings: [], syncStatus: { connected: false, lastSync: "Loading...", totalShowingsThisWeek: 0, confirmedCount: 0, completedCount: 0, cancelledCount: 0, pendingCount: 0 }, loading: true });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch('/api/gmail/brokerbay?days=30');
        if (!resp.ok) throw new Error('Failed');
        const json = await resp.json();
        if (cancelled) return;

        // Transform API confirmed/requested/cancelled into flat showings list
        const allShowings = [];
        let idCounter = 0;
        for (const s of (json.showings?.confirmed || [])) {
          allShowings.push({
            id: `bb-c-${idCounter++}`,
            property: s.address || s.subject || 'Unknown',
            date: s.showingDate || new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            time: s.showingTime || '',
            end: '',
            status: 'confirmed',
            buyerAgent: s.agentName || '',
            brokerage: s.brokerage || '',
            role: 'listing_agent',
            lockboxCode: '',
            requestedBy: s.agentName || '',
            notes: s.showingType || '',
            rawDate: s.date,
          });
        }
        for (const s of (json.showings?.requested || [])) {
          allShowings.push({
            id: `bb-r-${idCounter++}`,
            property: s.address || s.subject || 'Unknown',
            date: s.showingDate || new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            time: s.showingTime || '',
            end: '',
            status: 'requested',
            buyerAgent: s.agentName || '',
            brokerage: s.brokerage || '',
            role: 'listing_agent',
            lockboxCode: '',
            requestedBy: s.agentName || '',
            notes: s.showingType || '',
            rawDate: s.date,
          });
        }
        for (const s of (json.showings?.cancelled || [])) {
          allShowings.push({
            id: `bb-x-${idCounter++}`,
            property: s.address || s.subject || 'Unknown',
            date: s.showingDate || new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            time: s.showingTime || '',
            end: '',
            status: 'cancelled',
            buyerAgent: s.agentName || '',
            brokerage: s.brokerage || '',
            role: 'listing_agent',
            lockboxCode: '',
            requestedBy: s.agentName || '',
            notes: s.showingType || '',
            rawDate: s.date,
          });
        }

        const summary = json.summary || {};
        setData({
          showings: allShowings,
          syncStatus: {
            connected: true,
            lastSync: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            totalShowingsThisWeek: allShowings.filter(s => s.status !== 'cancelled').length,
            confirmedCount: summary.confirmedShowings || 0,
            completedCount: 0,
            cancelledCount: summary.cancelledShowings || 0,
            pendingCount: summary.requestedShowings || 0,
          },
          loading: false,
        });
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false, syncStatus: { ...prev.syncStatus, connected: false, lastSync: "Failed to load — reconnect Google" } }));
      }
    }
    load();
    const interval = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return data;
}

// Keep module-level references for components that still read these directly
let brokerBayShowings = [];
let brokerBaySyncStatus = {
  connected: false,
  lastSync: "Loading...",
  calendarFeedUrl: "",
  googleCalendarLinked: false,
  totalShowingsThisWeek: 0,
  confirmedCount: 0,
  completedCount: 0,
  cancelledCount: 0,
  pendingCount: 0,
};

// ─────────────────────────────────────────────
// DATA: METRICS + PIPELINE
// ─────────────────────────────────────────────
// Metrics — populated from live FUB/Sisu data when connected
const metricCards = [
  { title: "New Leads", value: "—", change: "", trend: "up", period: "This month", color: "#2563eb", target: 100, current: 0 },
  { title: "Active Deals", value: "—", change: "", trend: "up", period: "In pipeline", color: "#f59e0b", target: 100, current: 0 },
  { title: "Deals Closed", value: "—", change: "", trend: "up", period: "This month", color: "#10b981", target: 100, current: 0 },
  { title: "Closed Volume", value: "—", change: "", trend: "up", period: "This quarter", color: "#8b5cf6", target: 100, current: 0 },
];

const sidebarItems = [
  { id: "briefing", label: "Morning Brief", icon: Sun, badge: null },
  { id: "jacqui", label: "Jacqui", icon: Heart, badge: null },
  { id: "priorities", label: "Top Priorities", icon: Target, badge: 3 },
  { id: "calls", label: "Call List", icon: Phone, badge: 10 },
  { id: "emails", label: "Emails", icon: Mail, badge: 12 },
  { id: "crm", label: "Follow Up Boss", icon: Users, badge: null },
  { id: "sphere", label: "Sphere", icon: UserCheck, badge: null },
  { id: "tj-import", label: "TJ Import", icon: Archive, badge: null },
  { id: "calendar", label: "Calendar", icon: Calendar, badge: 6 },
  { id: "showings", label: "Showings", icon: MapPin, badge: 5 },
  { id: "leadgen", label: "Lead Gen", icon: Target, badge: null },
  { id: "pnl", label: "P&L", icon: DollarSign, badge: null },
  { id: "personal", label: "Personal", icon: User, badge: null },
  { id: "workout", label: "Workout", icon: Dumbbell, badge: null },
  { id: "meals", label: "Meals", icon: UtensilsCrossed, badge: null },
  { id: "marketing", label: "Marketing", icon: Megaphone, badge: null },
  { id: "learning", label: "Learning", icon: BookOpen, badge: null },
  { id: "active-listings", label: "Active Listings", icon: Home, badge: null },
  { id: "run-comps", label: "CMA", icon: BarChart3, badge: null },
  { id: "aps-parser", label: "APS Parser", icon: FileText, badge: null },
  { id: "listing-form", label: "Listing Form", icon: ClipboardList, badge: null },
  { id: "sellers", label: "Sellers", icon: Briefcase, badge: 3 },
  { id: "loo", label: "LOO", icon: FileText, badge: null },
  { id: "syncs", label: "Syncs & Routines", icon: RotateCw, badge: null },
  { id: "lifetime", label: "Lifetime Stats", icon: TrendingUp, badge: null },
];

// ─────────────────────────────────────────────
// DATA: TOP PRIORITIES OF THE DAY
// ─────────────────────────────────────────────
const defaultBig3 = [];
const backlogTasks = [];

// ─────────────────────────────────────────────
// COMPONENTS: SHARED
// ─────────────────────────────────────────────
function ProgressRing({ pct, color, size = 48 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: 20,
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid #f0f0f0",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, count, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
        {title} {count != null && <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>({count})</span>}
      </h3>
      {action && <span style={{ fontSize: 12, color: "#2563eb", cursor: "pointer", fontWeight: 600 }}>{action}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────
// HOUR OF POWER BAR (compact, always visible)
// ─────────────────────────────────────────────
function HourOfPowerBar() {
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dials, setDials] = useState(0);
  const [connects, setConnects] = useState(0);
  const [appts, setAppts] = useState(0);
  const [callIdx, setCallIdx] = useState(0);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [sessionDone, setSessionDone] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (active && !paused) {
      ref.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else clearInterval(ref.current);
    return () => clearInterval(ref.current);
  }, [active, paused]);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const { callList: dailyCallList } = useFubContext();
  const currentCall = dailyCallList[callIdx];
  const pace = elapsed > 10 ? ((dials / elapsed) * 60).toFixed(1) : null;

  const startSession = () => { setActive(true); setPaused(false); setElapsed(0); setDials(0); setConnects(0); setAppts(0); setCallIdx(0); setSessionDone(false); };
  const endSession = () => { setActive(false); setSessionDone(true); };

  const logCall = (outcome) => {
    setDials(d => d + 1);
    if (outcome === "connect") setConnects(c => c + 1);
    setCallIdx(i => Math.min(i + 1, dailyCallList.length - 1));
    setNote(""); setShowNote(false);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        background: active ? "linear-gradient(135deg, #111827 0%, #1e293b 100%)" : "#fff",
        borderRadius: 12, padding: "10px 18px",
        display: "flex", alignItems: "center", gap: 14,
        boxShadow: active ? "0 4px 20px rgba(0,0,0,0.12)" : "0 1px 3px rgba(0,0,0,0.05)",
        border: active ? "1px solid #c8a96e22" : "1px solid #f0f0f0",
        position: "relative", overflow: "hidden", flexWrap: "wrap",
      }}>
        {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #c8a96e, #f59e0b, #c8a96e)", backgroundSize: "200% 100%", animation: "hop-shimmer 2s linear infinite" }} />}

        {/* Title + timer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: active ? "linear-gradient(135deg,#c8a96e,#f59e0b)" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={14} color={active ? "#111827" : "#9ca3af"} strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: active ? "#c8a96e" : "#9ca3af", textTransform: "uppercase" }}>Hour of Power</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: active ? "#fff" : "#111827", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmt(elapsed)}</div>
          </div>
        </div>

        {/* Current contact (when active) */}
        {active && currentCall && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#ffffff0d", borderRadius: 8, padding: "6px 12px", border: "1px solid #ffffff12", minWidth: 200 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: currentCall.tagColor + "20", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: currentCall.tagColor }}>{currentCall.name.charAt(0)}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentCall.name}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{currentCall.phone}</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: currentCall.tagColor, background: currentCall.tagBg, padding: "2px 6px", borderRadius: 4 }}>{currentCall.tag}</span>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }}>
          {[
            { l: "Dials", v: dials, c: "#2563eb" },
            { l: "Connects", v: connects, c: "#10b981" },
            { l: "Appts", v: appts, c: "#f59e0b" },
          ].map(s => (
            <div key={s.l} style={{ textAlign: "center", background: active ? "#ffffff0a" : "#fafafa", borderRadius: 8, padding: "6px 12px", minWidth: 60, border: active ? "1px solid #ffffff10" : "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: active ? "#fff" : "#111827", fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
              <div style={{ fontSize: 9, color: active ? "#9ca3af" : "#6b7280", fontWeight: 600 }}>{s.l}</div>
            </div>
          ))}
          {pace && (
            <div style={{ textAlign: "center", background: "#ffffff0a", borderRadius: 8, padding: "6px 10px", border: "1px solid #ffffff10" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#c8a96e" }}>{pace}</div>
              <div style={{ fontSize: 9, color: "#9ca3af" }}>/min</div>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 5 }}>
          {!active && !sessionDone && (
            <button onClick={startSession} style={{ display: "flex", alignItems: "center", gap: 5, background: "linear-gradient(135deg,#c8a96e,#d4b878)", color: "#111827", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              <Play size={12} /> Start Session
            </button>
          )}
          {active && !paused && (
            <>
              <button onClick={() => setShowNote(!showNote)} style={{ display: "flex", alignItems: "center", gap: 4, background: "#2563eb", color: "#fff", border: "none", borderRadius: 7, padding: "7px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                <Phone size={11} /> Log
              </button>
              <button onClick={() => { setAppts(a => a + 1); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40", borderRadius: 7, padding: "7px 9px", fontSize: 11, cursor: "pointer" }}>
                <CalendarPlus size={11} />
              </button>
              <button onClick={() => setPaused(true)} style={{ background: "#ffffff12", color: "#fff", border: "1px solid #ffffff18", borderRadius: 7, padding: "7px 9px", cursor: "pointer" }}>
                <Pause size={11} />
              </button>
              <button onClick={endSession} style={{ background: "#ef444418", color: "#ef4444", border: "1px solid #ef444430", borderRadius: 7, padding: "7px 9px", cursor: "pointer" }}>
                <Square size={11} />
              </button>
            </>
          )}
          {active && paused && (
            <>
              <button onClick={() => setPaused(false)} style={{ display: "flex", alignItems: "center", gap: 4, background: "#10b981", color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Play size={11} /> Resume</button>
              <button onClick={endSession} style={{ background: "#ef444418", color: "#ef4444", border: "1px solid #ef444430", borderRadius: 7, padding: "7px 9px", cursor: "pointer" }}><Square size={11} /> </button>
            </>
          )}
          {sessionDone && (
            <>
              <button onClick={() => setSessionDone(false)} style={{ display: "flex", alignItems: "center", gap: 4, background: "#f5f3ff", color: "#8b5cf6", border: "1px solid #c4b5fd", borderRadius: 7, padding: "7px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Sparkles size={11} /> Review</button>
              <button onClick={startSession} style={{ display: "flex", alignItems: "center", gap: 4, background: "linear-gradient(135deg,#c8a96e,#d4b878)", color: "#111827", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><Play size={11} /> Again</button>
            </>
          )}
        </div>
      </div>

      {/* Quick-log panel */}
      {showNote && active && (
        <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginTop: 6, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#6b7280", minWidth: 90 }}>
            <strong style={{ color: "#111827" }}>{currentCall?.name}</strong>
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Quick note..." style={{ flex: 1, minWidth: 150, padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, outline: "none" }} />
          <button onClick={() => logCall("connect")} style={{ background: "#ecfdf5", color: "#10b981", border: "1px solid #a7f3d0", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><PhoneCall size={11} /> Connected</button>
          <button onClick={() => logCall("vm")} style={{ background: "#fffbeb", color: "#f59e0b", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>VM</button>
          <button onClick={() => logCall("no_answer")} style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>No Ans</button>
          <button onClick={() => setShowNote(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer" }}><X size={13} /></button>
        </div>
      )}
      <style>{`@keyframes hop-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// MORNING BRIEFING
// ─────────────────────────────────────────────
function MorningCalendarSnapshot() {
  const [status, setStatus] = useState({ connected: false });
  const [events, setEvents] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const sRes = await fetch('/api/calendar/status');
        const sData = await sRes.json();
        setStatus(sData);
        if (sData.connected) {
          const eRes = await fetch('/api/calendar/events');
          if (eRes.ok) { const eData = await eRes.json(); setEvents(eData.events || []); }
        }
      } catch { /* use fallback */ }
    })();
  }, []);

  const formatTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto' });
  };

  const displayEvents = status.connected && events.length > 0 ? events : null;
  const fallbackEvents = todayCalendar;

  // Group events by day for 3-day view
  const groupByDay = (evts) => {
    const groups = {};
    const now = new Date();
    evts.forEach(ev => {
      const evDate = new Date(ev.start);
      const dateKey = evDate.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(ev);
    });
    // Sort keys and label them
    const todayKey = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
    const tmrwKey = tmrw.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([key, evts]) => ({
      label: key === todayKey ? 'Today' : key === tmrwKey ? 'Tomorrow' : new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      events: evts,
    }));
  };

  const dayGroups = displayEvents ? groupByDay(displayEvents) : null;

  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Calendar size={14} color="#d97706" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
          {displayEvents ? events.length : fallbackEvents.length} event{(displayEvents ? events.length : fallbackEvents.length) !== 1 ? "s" : ""} — 3 day view
        </span>
        {status.connected
          ? <span style={{ fontSize: 9, fontWeight: 600, color: "#059669", background: "#ecfdf5", padding: "1px 5px", borderRadius: 3 }}>GCal live</span>
          : <span style={{ fontSize: 9, fontWeight: 600, color: "#d97706", background: "#fef3c7", padding: "1px 5px", borderRadius: 3 }}>GCal offline</span>
        }
      </div>
      {dayGroups ? dayGroups.map((group, gi) => (
        <div key={gi} style={{ marginBottom: gi < dayGroups.length - 1 ? 8 : 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: group.label === 'Today' ? '#d97706' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, marginTop: gi > 0 ? 4 : 0 }}>{group.label}</div>
          {group.events.map((ev, i) => (
            <div key={ev.id || i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 3, height: 18, borderRadius: 2, background: group.label === 'Today' ? "#2563eb" : "#94a3b8", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{ev.title}</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>{ev.allDay ? "All day" : formatTime(ev.start)}</div>
              </div>
            </div>
          ))}
        </div>
      )) : fallbackEvents.map((ev, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 3, height: 20, borderRadius: 2, background: ev.color, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{ev.title}</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>{ev.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CallListPreview() {
  const { callList, loading, connected } = useFubContext();
  const hotCount = callList.filter(c => c.bucket === 'hot').length;
  const warmCount = callList.filter(c => c.bucket === 'warm').length;
  const coldCount = callList.filter(c => c.bucket === 'cold').length;
  const pastCount = callList.filter(c => c.bucket === 'past').length;
  const sphereCount = callList.filter(c => c.bucket === 'sphere').length;
  const activeCount = callList.filter(c => c.bucket === 'active').length;

  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Phone size={14} color="#2563eb" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>{callList.length} calls queued</span>
        {connected && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>}
        {loading && <span style={{ fontSize: 9, color: "#9ca3af" }}>syncing...</span>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[
          { label: "Hot", count: hotCount, color: "#ef4444", bg: "#fef2f2" },
          { label: "Warm", count: warmCount, color: "#f59e0b", bg: "#fffbeb" },
          { label: "Cold", count: coldCount, color: "#6b7280", bg: "#f3f4f6" },
          { label: "Past", count: pastCount + sphereCount, color: "#8b5cf6", bg: "#f5f3ff" },
          { label: "Active", count: activeCount, color: "#2563eb", bg: "#eff6ff" },
        ].filter(b => b.count > 0).map(b => (
          <span key={b.label} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: b.bg, padding: "3px 8px", borderRadius: 4 }}>{b.count} {b.label}</span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{connected ? "Live from Follow Up Boss — zero call bias." : "Balanced rotation — no call bias."}</div>
    </div>
  );
}

// ─── MISSED EMAILS RECOVERY BANNER ───
// Shows up after Gmail reconnects from downtime, with all emails that came in while offline
// ─────────────────────────────────────────────
// GOOGLE CONNECTION BANNER — single reconnect point for Calendar + Gmail
// ─────────────────────────────────────────────
function GoogleConnectionBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/calendar/status');
        const data = await res.json();
        setStatus(data);
      } catch { setStatus({ connected: false, configured: false }); }
    })();
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/calendar/status');
        const data = await res.json();
        setStatus(data);
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  if (!status) return null;

  // CONNECTED — small green status pill with Disconnect option
  if (status.connected) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>Google connected</span>
          <span style={{ fontSize: 11, color: "#15803d", marginLeft: 8 }}>Calendar, Gmail, Drive, and Email AI active.</span>
        </div>
        <button onClick={() => { window.location.href = '/api/auth/google'; }} title="Re-run Google consent (e.g. to grant new scopes)" style={{
          background: "transparent", color: "#15803d", border: "1px solid #bbf7d0",
          padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        }}>
          <RefreshCw size={11} /> Reconnect
        </button>
        <button onClick={async () => {
          if (!window.confirm('Disconnect Google?\n\nThis revokes Agent HQ\'s access to your Google account on this server. Calendar/Gmail/Drive features will stop working until you reconnect. Your data on Google is untouched.')) return;
          try {
            await fetch('/api/auth/disconnect', { method: 'POST' });
            window.location.reload();
          } catch (e) { alert('Disconnect failed: ' + e.message); }
        }} style={{
          background: "transparent", color: "#dc2626", border: "1px solid #fecaca",
          padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        }}>
          <X size={11} /> Disconnect
        </button>
      </div>
    );
  }

  // DISCONNECTED — yellow banner with Reconnect button (existing behaviour)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 12 }}>
      <AlertTriangle size={16} color="#d97706" />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>Google disconnected</span>
        <span style={{ fontSize: 11, color: "#b45309", marginLeft: 8 }}>Calendar, Gmail, and Email AI need a reconnect.</span>
      </div>
      <button onClick={() => { window.location.href = '/api/auth/google'; }} style={{
        background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", border: "none",
        padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
      }}>
        <RefreshCw size={12} /> Reconnect to Google
      </button>
    </div>
  );
}

function MissedEmailsBanner() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/gmail/missed');
        const json = await res.json();
        if (json.hasMissed) setData(json);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await fetch('/api/gmail/missed/dismiss', { method: 'POST' });
      setData(null);
    } catch {}
    setDismissing(false);
  };

  if (loading || !data) return null;

  const priorityColor = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' };
  const priorityBg = { high: '#fef2f2', medium: '#fffbeb', low: '#f3f4f6' };
  const categoryLabel = {
    brokerbay: 'BrokerBay', crm_lead: 'FUB Lead', deal_tracker: 'Sisu', listing_alert: 'REALM',
    automation: 'Make.com', team: 'Faris Team', transaction: 'Transaction', showing: 'Showing',
    listing: 'Listing', important: 'Important', general: 'General',
  };

  return (
    <Card style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fff1f2 50%, #fffbeb 100%)', border: '1px solid #fca5a5', marginBottom: 16, position: 'relative' }}>
      <button onClick={handleDismiss} disabled={dismissing} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
        {dismissing ? 'Clearing...' : <X size={14} />}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #ef4444, #f59e0b)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AlertTriangle size={18} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#991b1b' }}>
            {data.totalCount} emails arrived while Gmail was offline
          </div>
          <div style={{ fontSize: 11, color: '#b91c1c' }}>
            Offline for ~{data.offlineHours < 1 ? 'under 1 hour' : `${Math.round(data.offlineHours)} hours`} ({new Date(data.fromDate).toLocaleDateString()} — {new Date(data.toDate).toLocaleDateString()})
          </div>
        </div>
      </div>

      {/* Priority summary chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {data.highPriority > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: '#fef2f2', padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca' }}>
            {data.highPriority} high priority
          </span>
        )}
        {data.mediumPriority > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: '#fffbeb', padding: '4px 10px', borderRadius: 6, border: '1px solid #fde68a' }}>
            {data.mediumPriority} medium priority
          </span>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', padding: '4px 10px', borderRadius: 6 }}>
          {data.totalCount - (data.highPriority || 0) - (data.mediumPriority || 0)} low / FYI
        </span>
      </div>

      {/* Expandable email list */}
      <button onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
        border: '1px solid #fca5a5', background: '#fff', color: '#991b1b',
        fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: expanded ? 10 : 0,
      }}>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Collapse' : `Review all ${data.totalCount} emails`}
      </button>

      {expanded && (
        <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.emails.map((em, i) => (
            <div key={em.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: '#fff', borderRadius: 8, border: `1px solid ${em.priority === 'high' ? '#fecaca' : em.priority === 'medium' ? '#fde68a' : '#e5e7eb'}`,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: priorityColor[em.priority] || '#6b7280',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{em.from}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                    color: priorityColor[em.priority], background: priorityBg[em.priority],
                  }}>{categoryLabel[em.category] || em.category}</span>
                  {!em.isRead && <span style={{ fontSize: 8, fontWeight: 700, color: '#fff', background: '#2563eb', padding: '1px 5px', borderRadius: 3 }}>NEW</span>}
                </div>
                <div style={{ fontSize: 11, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{em.subject}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{em.snippet}</div>
              </div>
              <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>{em.date}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: expanded ? 10 : 8 }}>
        <button onClick={handleDismiss} disabled={dismissing} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #d1d5db', background: '#fff', color: '#374151',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          <Check size={12} /> Mark all reviewed
        </button>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>Backfilled at {new Date(data.backfillTimestamp).toLocaleTimeString()}</span>
      </div>
    </Card>
  );
}

function MorningBriefing() {
  const eaData = useContext(EaContext);
  const { showings: briefShowings } = useBrokerBayShowings();
  const awaitingYou = eaData?.threads?.filter(t => t.state === 'awaiting_you') || [];
  const urgentEmails = awaitingYou.length > 0 ? awaitingYou.slice(0, 5) : emailInboxFallback;
  const todayKey = new Date().toISOString().slice(0, 10); // resets daily
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('agenthq-brief-dismissed') === todayKey; } catch { return false; }
  });
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('agenthq-brief-dismissed', todayKey); } catch {}
  };

  return (
    <Card style={{ background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", border: "1px solid #fde68a", marginBottom: 16, position: "relative" }}>
      <button onClick={handleDismiss} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", color: "#d97706", cursor: "pointer" }}><X size={14} /></button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#c8a96e,#f59e0b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Coffee size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#92400e" }}>Good morning, Jonathan</div>
          <div style={{ fontSize: 12, color: "#b45309" }}>Here's your day at a glance.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {/* Listing Showings snapshot — LIVE from Gmail */}
        {(() => {
          // Filter to today's and upcoming showings (non-cancelled)
          const now = new Date();
          const todayStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const activeShowings = briefShowings.filter(s => s.status !== "cancelled");
          const todayShowings = activeShowings.filter(s => s.date === todayStr);
          // If none today, show most recent confirmed showings
          const displayShowings = todayShowings.length > 0 ? todayShowings : activeShowings;
          const showingLabel = todayShowings.length > 0
            ? `${todayShowings.length} today`
            : `${activeShowings.length} this month`;
          return (
            <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <MapPin size={14} color="#e11d48" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>Showings</span>
                {activeShowings.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>}
              </div>
              {displayShowings.length > 0 ? (
                <>
                  <div style={{ fontSize: 10, color: "#92400e", fontWeight: 600, marginBottom: 6 }}>{showingLabel}</div>
                  {displayShowings.slice(0, 3).map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 3, height: 20, borderRadius: 2, background: s.status === "confirmed" ? "#059669" : s.status === "requested" ? "#d97706" : "#2563eb", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.property.split(",")[0]}</div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{s.time || s.date} · {s.buyerAgent || s.status}</div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>No showings found</div>
              )}
            </div>
          );
        })()}

        {/* Calendar snapshot */}
        <MorningCalendarSnapshot />

        {/* Emails needing response */}
        <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Mail size={14} color="#dc2626" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>{urgentEmails.length > 0 ? `${urgentEmails.length} emails need you` : 'Emails'}</span>
            {urgentEmails.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>}
            {urgentEmails.length === 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "#fffbeb", padding: "1px 5px", borderRadius: 3 }}>GCal offline</span>}
          </div>
          {urgentEmails.length > 0 ? urgentEmails.slice(0, 3).map((em, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: em.priority === "high" ? "#fef2f2" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: em.priority === "high" ? "#ef4444" : "#6b7280" }}>{em.from.charAt(0)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{em.from}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{em.subject}</div>
              </div>
            </div>
          )) : (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Gmail offline — reconnect above</div>
            </div>
          )}
        </div>

      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────
// SHARED FEEDBACK STATE — tracks submitted feedback across components
// ─────────────────────────────────────────────
let _submittedFeedbackIds = (() => {
  // Try localStorage first (survives server redeploys)
  try {
    const local = localStorage.getItem('agenthq-feedback-submitted');
    if (local) return JSON.parse(local);
  } catch {}
  return [];
})();
function getSubmittedFeedback() { return _submittedFeedbackIds; }
function markFeedbackSubmitted(id) {
  if (!_submittedFeedbackIds.includes(id)) {
    _submittedFeedbackIds = [..._submittedFeedbackIds, id];
    try { localStorage.setItem('agenthq-feedback-submitted', JSON.stringify(_submittedFeedbackIds)); } catch {}
    fetch('/api/feedback/submitted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: _submittedFeedbackIds }),
    }).catch(() => {});
  }
}
// Load submitted IDs from server on startup, merge with localStorage
fetch('/api/feedback/submitted').then(r => r.json()).then(data => {
  if (data?.ids?.length) {
    // Merge server + local to avoid losing any
    const merged = [...new Set([..._submittedFeedbackIds, ...data.ids])];
    _submittedFeedbackIds = merged;
    try { localStorage.setItem('agenthq-feedback-submitted', JSON.stringify(merged)); } catch {}
  }
}).catch(() => {});

// AI Feedback Formatter — structures raw dictation into sandwich format
function formatFeedbackSandwich(raw) {
  const lines = raw.trim();
  if (!lines) return '';

  // Simple structured output — the server endpoint will do the real AI formatting
  return `Thank you for the opportunity to show this property.\n\n${lines}\n\nPlease don't hesitate to reach out if you have any questions.\n\nBest regards,\nJonathan Wallace`;
}

// ─────────────────────────────────────────────
// OUTSTANDING FEEDBACK BAR (compact, with inline dictation)
// ─────────────────────────────────────────────
function OutstandingFeedbackBar() {
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agenthq-feedback-dismissed') || '{}'); } catch { return {}; }
  });
  const persistDismiss = (updater) => {
    setDismissed(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('agenthq-feedback-dismissed', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [submitted, setSubmitted] = useState(getSubmittedFeedback());
  const [expandedId, setExpandedId] = useState(null);
  const [rawInput, setRawInput] = useState('');
  const [formatted, setFormatted] = useState('');
  const [mode, setMode] = useState('idle'); // idle | dictating | formatting | formatted | done
  const [, forceUpdate] = useState(0);

  const visible = outstandingFeedback.filter(f => !dismissed[f.id] && !submitted.includes(f.id));
  if (visible.length === 0) return null;

  const handleFormat = async (fb) => {
    setMode('formatting');
    try {
      const res = await fetch('/api/feedback/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: rawInput, address: fb.address, listingAgent: fb.listingAgent }),
      });
      const data = await res.json();
      setFormatted(data.formatted || formatFeedbackSandwich(rawInput));
    } catch {
      setFormatted(formatFeedbackSandwich(rawInput));
    }
    setMode('formatted');
  };

  const handleSubmit = (fb) => {
    // Copy formatted text to clipboard
    navigator.clipboard?.writeText(formatted).catch(() => {});
    // Mark as submitted
    markFeedbackSubmitted(fb.id);
    setSubmitted(prev => [...prev, fb.id]);
    // Open BrokerBay
    if (fb.feedbackUrl) window.open(fb.feedbackUrl, '_blank');
    setMode('done');
    setExpandedId(null);
    setRawInput('');
    setFormatted('');
    forceUpdate(n => n + 1);
  };

  const handleMarkDone = (fb) => {
    markFeedbackSubmitted(fb.id);
    setSubmitted(prev => [...prev, fb.id]);
    forceUpdate(n => n + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 0 }}>
      {visible.map(fb => {
        const isExpanded = expandedId === fb.id;

        return (
          <div key={fb.id} style={{
            borderRadius: 12, background: "#fff", border: isExpanded ? "2px solid #e11d48" : "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)", overflow: "hidden",
          }}>
            {/* Compact bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MessageCircle size={16} color="#e11d48" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                  Feedback due — {fb.address}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
                  {fb.listingAgent} &middot; {fb.brokerage} &middot; Shown {fb.time}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => {
                  if (isExpanded) {
                    setExpandedId(null); setMode('idle'); setRawInput(''); setFormatted('');
                  } else {
                    setExpandedId(fb.id); setMode('dictating');
                  }
                }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#e11d48", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  {isExpanded ? "Close" : "Leave Feedback"}
                </button>
                <button onClick={() => handleMarkDone(fb)} title="Already submitted on BrokerBay" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#9ca3af", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Done
                </button>
                <button onClick={() => persistDismiss(prev => ({ ...prev, [fb.id]: true }))} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#d1d5db", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Expanded dictation panel */}
            {isExpanded && (
              <div style={{ padding: "0 16px 16px 16px" }}>
                {mode === 'dictating' && (
                  <div style={{ padding: 14, borderRadius: 10, border: "1px solid #fecdd3", background: "#fff8f8" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#be123c", marginBottom: 6 }}>Dictate your feedback for {fb.address}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Speak naturally. Include what your client thought (positives first), any concerns, and questions. AI will format it professionally.</div>
                    <textarea
                      value={rawInput}
                      onChange={e => setRawInput(e.target.value)}
                      autoFocus
                      placeholder={'e.g. "My client might be interested in this property. It shows well and the location is great. Could use a little work — basement is unfinished and a bit rough around the edges. Questions: when was the last time the sump pump went off? There\'s a stain in the main floor bedroom, do you know what that\'s from?"'}
                      style={{
                        width: "100%", minHeight: 100, padding: 12, borderRadius: 8, border: "1px solid #fecdd3",
                        fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                        lineHeight: 1.5, background: "#fff", boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>AI will organize: positives → constructive notes → questions</div>
                      <button
                        onClick={() => handleFormat(fb)}
                        disabled={!rawInput.trim()}
                        style={{
                          padding: "8px 20px", borderRadius: 8, border: "none",
                          background: rawInput.trim() ? "#e11d48" : "#d1d5db",
                          color: "#fff", fontSize: 12, fontWeight: 600,
                          cursor: rawInput.trim() ? "pointer" : "not-allowed",
                        }}
                      >
                        Format with AI →
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'formatting' && (
                  <div style={{ padding: 20, borderRadius: 10, background: "#fff8f8", textAlign: "center" }}>
                    <RefreshCw size={18} color="#e11d48" style={{ margin: "0 auto 6px", animation: "spin 1s linear infinite" }} />
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Formatting your feedback...</div>
                  </div>
                )}

                {mode === 'formatted' && (
                  <div style={{ padding: 14, borderRadius: 10, border: "1px solid #86efac", background: "#f0fdf4" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Formatted — Ready to Submit</div>
                      <button onClick={() => setMode('dictating')} style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>← Edit</button>
                    </div>
                    <div style={{
                      padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #bbf7d0",
                      fontSize: 12, lineHeight: 1.6, color: "#1f2937", whiteSpace: "pre-wrap",
                      maxHeight: 200, overflowY: "auto",
                    }}>
                      {formatted}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                      <button onClick={() => { navigator.clipboard?.writeText(formatted); }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        Copy
                      </button>
                      <button
                        onClick={() => handleSubmit(fb)}
                        style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <ExternalLink size={12} /> Submit on BrokerBay
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// FEEDBACK CARD — full dictation + AI formatting + BrokerBay submit
// ─────────────────────────────────────────────
function FeedbackCard({ fb }) {
  const [mode, setMode] = useState('idle'); // idle | dictating | formatting | formatted | submitted
  const [rawInput, setRawInput] = useState('');
  const [formatted, setFormatted] = useState('');
  const [, forceUpdate] = useState(0);

  const handleFormat = async () => {
    setMode('formatting');
    try {
      const res = await fetch('/api/feedback/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: rawInput, address: fb.address, listingAgent: fb.listingAgent }),
      });
      const data = await res.json();
      setFormatted(data.formatted || formatFeedbackSandwich(rawInput));
    } catch {
      setFormatted(formatFeedbackSandwich(rawInput));
    }
    setMode('formatted');
  };

  const handleSubmit = () => {
    markFeedbackSubmitted(fb.id);
    setMode('submitted');
    // Open BrokerBay with the feedback ready to paste
    if (fb.feedbackUrl) {
      window.open(fb.feedbackUrl, '_blank');
    }
    forceUpdate(n => n + 1);
  };

  if (mode === 'submitted') {
    return (
      <div style={{ borderRadius: 12, border: "2px solid #86efac", overflow: "hidden", background: "#f0fdf4", padding: 20, textAlign: "center" }}>
        <CheckCircle2 size={28} color="#16a34a" style={{ margin: "0 auto 8px" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>Feedback Submitted</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{fb.address} — BrokerBay opened in new tab. Paste your formatted feedback there.</div>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, border: "2px solid #fecdd3", overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: "14px 16px", background: "#fff1f2" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{fb.address}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{fb.date} &middot; {fb.time}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2", padding: "4px 10px", borderRadius: 6, border: "1px solid #fecaca" }}>FEEDBACK DUE</span>
        </div>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, marginBottom: 12 }}>
          <div><span style={{ color: "#9ca3af" }}>Listing Agent:</span> <span style={{ fontWeight: 600 }}>{fb.listingAgent}</span></div>
          <div><span style={{ color: "#9ca3af" }}>Brokerage:</span> <span style={{ fontWeight: 600 }}>{fb.brokerage}</span></div>
          <div><span style={{ color: "#9ca3af" }}>Email:</span> <span style={{ fontWeight: 600 }}>{fb.listingAgentEmail}</span></div>
          <div><span style={{ color: "#9ca3af" }}>Phone:</span> <span style={{ fontWeight: 600 }}>{fb.listingAgentPhone}</span></div>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, padding: "8px 10px", background: "#f9fafb", borderRadius: 6 }}>
          {fb.notes}
        </div>

        {/* Dictation / Formatting Area */}
        {mode === 'idle' && (
          <div style={{ padding: 14, borderRadius: 10, border: "2px solid #e11d48", background: "#fff1f2", textAlign: "center" }}>
            <MessageCircle size={20} color="#e11d48" style={{ margin: "0 auto 6px" }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Dictate Your Feedback</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>Type or dictate your raw thoughts. AI will format them professionally: positives first, constructive notes, then questions.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => setMode('dictating')} style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: "#e11d48", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Start Feedback
              </button>
              {fb.feedbackUrl && (
                <button onClick={() => window.open(fb.feedbackUrl, '_blank')} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  <ExternalLink size={12} /> Open BrokerBay Directly
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'dictating' && (
          <div style={{ padding: 14, borderRadius: 10, border: "2px solid #3b82f6", background: "#eff6ff" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 8 }}>Your Raw Feedback</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Speak naturally — include positives, any concerns, and questions. AI will organize it professionally.</div>
            <textarea
              value={rawInput}
              onChange={e => setRawInput(e.target.value)}
              placeholder="e.g. My client might be interested. Shows well but a little rough around the edges. Basement is unfinished. Good location though, could be an opportunity. Questions: when did the sump pump last go off? There's a stain in the main floor bedroom — what's that from?"
              style={{
                width: "100%", minHeight: 120, padding: 12, borderRadius: 8, border: "1px solid #bfdbfe",
                fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                lineHeight: 1.5, background: "#fff",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setMode('idle'); setRawInput(''); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={handleFormat}
                disabled={!rawInput.trim()}
                style={{
                  padding: "8px 24px", borderRadius: 8, border: "none",
                  background: rawInput.trim() ? "#3b82f6" : "#d1d5db",
                  color: "#fff", fontSize: 12, fontWeight: 600,
                  cursor: rawInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                Format with AI
              </button>
            </div>
          </div>
        )}

        {mode === 'formatting' && (
          <div style={{ padding: 20, borderRadius: 10, border: "2px dashed #d1d5db", background: "#fafafa", textAlign: "center" }}>
            <RefreshCw size={20} color="#6b7280" style={{ margin: "0 auto 6px", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Formatting your feedback...</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Organizing into professional sandwich format</div>
          </div>
        )}

        {mode === 'formatted' && (
          <div style={{ padding: 14, borderRadius: 10, border: "2px solid #16a34a", background: "#f0fdf4" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Formatted Feedback — Ready to Submit</div>
              <button onClick={() => setMode('dictating')} style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Edit Raw</button>
            </div>
            <div style={{
              padding: 12, borderRadius: 8, background: "#fff", border: "1px solid #bbf7d0",
              fontSize: 13, lineHeight: 1.6, color: "#1f2937", whiteSpace: "pre-wrap",
              maxHeight: 300, overflowY: "auto",
            }}>
              {formatted}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { navigator.clipboard?.writeText(formatted); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Copy to Clipboard
              </button>
              <button
                onClick={handleSubmit}
                style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                <ExternalLink size={13} /> Submit on BrokerBay
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CALL LIST SECTION
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// LEAD AUTO-IMPORT BAR
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// TEAM JORDAN BATCH IMPORT DASHBOARD
// ─────────────────────────────────────────────
function TeamJordanImport() {
  const [status, setStatus] = useState(null);
  const [setting, setSetting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [candidates, setCandidates] = useState([]);    // parsed contacts pending review
  const [skippedList, setSkippedList] = useState([]);   // auto-filtered contacts
  const [scanResult, setScanResult] = useState(null);   // last scan metadata
  const [importResult, setImportResult] = useState(null); // last import result
  const [showSkipped, setShowSkipped] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/tj/status');
      const data = await res.json();
      setStatus(data);
      // Restore pending candidates if page reloads during review
      if (data.status === 'review' && data.pendingCandidates?.length > 0 && candidates.length === 0) {
        setCandidates(data.pendingCandidates.map(c => ({ ...c, approved: true })));
      }
    } catch {}
  };

  useEffect(() => { fetchStatus(); }, []);

  const runSetup = async () => {
    setSetting(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/tj/setup');
      const data = await res.json();
      if (data.error) { setSetupError(data.error); setSetting(false); return; }
      if (!data.ready && !data.labelFound) {
        setSetupError(data.availableLabels?.length > 0
          ? `Gmail label not found. Available labels: ${data.availableLabels.join(', ')}`
          : 'Gmail label "jonathan@teamjordan.ca/All Mail" not found. No custom labels found in this Gmail account.');
        setSetting(false);
        return;
      }
      setStatus(prev => ({
        ...prev,
        status: data.state?.status || 'ready',
        progress: { processed: 0, total: 0, leadsCreated: 0, realtorsCreated: 0, lawyersCreated: 0, leadsSkippedExisting: 0, notesAdded: 0, emailsSkipped: 0, errors: 0, ...data.state?.progress },
        currentBatch: data.state?.currentBatch || 0,
        hasMore: true,
        labelName: data.labelName,
      }));
      await fetchStatus();
    } catch (err) {
      setSetupError('Network error — could not reach the server.');
    }
    setSetting(false);
  };

  // SCAN: parse next batch of emails, return candidates for review
  const runScan = async () => {
    setScanning(true);
    setSetupError(null);
    setCandidates([]);
    setSkippedList([]);
    setScanResult(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/tj/scan', { method: 'POST' });
      const data = await res.json();
      if (data.error) { setSetupError(data.error); setScanning(false); return; }
      setCandidates((data.candidates || []).map(c => ({ ...c, approved: true })));
      setSkippedList(data.skipped || []);
      setScanResult(data);
      await fetchStatus();
    } catch (err) {
      setSetupError('Network error during scan.');
    }
    setScanning(false);
  };

  // Toggle individual candidate approval
  const toggleCandidate = (msgId) => {
    setCandidates(prev => prev.map(c => c.msgId === msgId ? { ...c, approved: !c.approved } : c));
  };

  // Select/deselect all
  const toggleAll = (val) => {
    setCandidates(prev => prev.map(c => ({ ...c, approved: val })));
  };

  // Change candidate type
  const changeCandidateType = (msgId, newType) => {
    setCandidates(prev => prev.map(c => c.msgId === msgId ? { ...c, type: newType } : c));
  };

  // APPROVE: import checked candidates into FUB
  const runApprove = async () => {
    const approved = candidates.filter(c => c.approved);
    if (approved.length === 0) {
      setSetupError('No candidates selected for import.');
      return;
    }
    setImporting(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/tj/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: approved.map(c => ({ msgId: c.msgId, type: c.type, firstName: c.firstName, lastName: c.lastName })) }),
      });
      const data = await res.json();
      if (data.error) { setSetupError(data.error); setImporting(false); return; }
      setImportResult(data.results);
      setCandidates([]);
      setSkippedList([]);
      setScanResult(null);
      await fetchStatus();
    } catch (err) {
      setSetupError('Network error during import.');
    }
    setImporting(false);
  };

  const p = status?.progress || {};
  const approvedCount = candidates.filter(c => c.approved).length;
  const typeColor = { realtor: '#f59e0b', lawyer: '#6366f1', lead: '#10b981', active_client: '#2563eb', past_client: '#7c3aed' };

  // Edit candidate fields
  const updateCandidate = (msgId, field, value) => {
    setCandidates(prev => prev.map(c => c.msgId === msgId ? { ...c, [field]: value } : c));
  };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Inbox size={16} color="#8b5cf6" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Team Jordan Archive Import</span>
          {status?.status === 'complete' && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>COMPLETE</span>}
          {status?.status === 'review' && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#f59e0b", padding: "1px 5px", borderRadius: 3 }}>REVIEW</span>}
          {status?.status === 'importing' && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#8b5cf6", padding: "1px 5px", borderRadius: 3 }}>IMPORTING</span>}
        </div>
      </div>

      {/* Setup phase */}
      {(!status || status.status === 'idle') && (
        <div style={{ padding: "16px 0" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
            Scan the <strong>jonathan@teamjordan.ca / All Mail</strong> label in Gmail. Each batch will show you what it found for approval before anything gets imported into FUB.
          </div>
          {setupError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <AlertTriangle size={13} color="#ef4444" />
                <strong style={{ color: "#dc2626" }}>Setup Error</strong>
              </div>
              <div style={{ color: "#991b1b" }}>{setupError}</div>
            </div>
          )}
          <button onClick={runSetup} disabled={setting} style={{
            display: "flex", alignItems: "center", gap: 6, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8,
            padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: setting ? "wait" : "pointer",
          }}>
            {setting ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Scanning label...</> : <><Search size={13} /> Set Up Import</>}
          </button>
        </div>
      )}

      {/* Main workflow — ready / review / paused / complete */}
      {(status?.status === 'ready' || status?.status === 'paused' || status?.status === 'review' || status?.status === 'scanning' || status?.status === 'importing' || status?.status === 'complete') && (
        <>
          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              { label: "Leads Created", value: p.leadsCreated || 0, color: "#10b981" },
              { label: "Realtors Found", value: p.realtorsCreated || 0, color: "#f59e0b" },
              { label: "Lawyers Found", value: p.lawyersCreated || 0, color: "#6366f1" },
              { label: "Already in FUB", value: p.leadsSkippedExisting || 0, color: "#2563eb" },
              { label: "Notes Added", value: p.notesAdded || 0, color: "#8b5cf6" },
              { label: "Skipped / Errors", value: (p.emailsSkipped || 0) + (p.errors || 0), color: "#6b7280" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center", padding: 10, background: "#fafafa", borderRadius: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Import result banner */}
          {importResult && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#166534" }}>
              <strong>Import complete:</strong> {importResult.imported} imported, {importResult.rejected} rejected, {importResult.errors} errors
            </div>
          )}

          {setupError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#991b1b" }}>
              <AlertTriangle size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> {setupError}
            </div>
          )}

          {/* SCAN button — shown when no candidates are pending review */}
          {candidates.length === 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={runScan} disabled={scanning || status?.status === 'complete'} style={{
                display: "flex", alignItems: "center", gap: 4, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6,
                padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: scanning ? "wait" : "pointer", opacity: status?.status === 'complete' ? 0.5 : 1,
              }}>
                {scanning ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Scanning batch {(status?.currentBatch || 0) + 1}...</> : <><Search size={12} /> Scan Next Batch ({TJ_BATCH_SIZE} emails)</>}
              </button>
              {status?.lastProcessedAt && (
                <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center" }}>Last: {new Date(status.lastProcessedAt).toLocaleTimeString()}</span>
              )}
              <button onClick={async () => {
                if (confirm('Reset all import progress? This cannot be undone.')) {
                  await fetch('/api/tj/reset', { method: 'POST' });
                  setStatus(null); setCandidates([]); setSkippedList([]); setScanResult(null); setImportResult(null); setSetupError(null);
                  await fetchStatus();
                }
              }} style={{
                display: "flex", alignItems: "center", gap: 4, background: "transparent", color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 6,
                padding: "7px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", marginLeft: "auto",
              }}>
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          )}

          {/* REVIEW TABLE — shown when candidates exist */}
          {candidates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
                  Review Batch {scanResult?.batch || '?'} — {candidates.length} contacts found
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => toggleAll(true)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #d1d5db", background: "#f0fdf4", color: "#166534", cursor: "pointer", fontWeight: 600 }}>Select All</button>
                  <button onClick={() => toggleAll(false)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #d1d5db", background: "#fef2f2", color: "#991b1b", cursor: "pointer", fontWeight: 600 }}>Deselect All</button>
                </div>
              </div>

              {/* Candidate list */}
              <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", width: 32 }}></th>
                      <th style={{ padding: "8px 3px", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>First</th>
                      <th style={{ padding: "8px 3px", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>Last</th>
                      <th style={{ padding: "8px 3px", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>Email</th>
                      <th style={{ padding: "8px 3px", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>Phone</th>
                      <th style={{ padding: "8px 3px", textAlign: "center", fontWeight: 600, color: "#6b7280", width: 110 }}>Type</th>
                      <th style={{ padding: "8px 3px", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c, i) => (
                      <tr key={c.msgId} style={{ borderBottom: "1px solid #f3f4f6", background: c.approved ? "#fff" : "#fafafa", opacity: c.approved ? 1 : 0.5 }}>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <input type="checkbox" checked={c.approved} onChange={() => toggleCandidate(c.msgId)} style={{ cursor: "pointer", width: 15, height: 15 }} />
                        </td>
                        <td style={{ padding: "4px 3px" }}>
                          <input value={c.firstName} onChange={e => updateCandidate(c.msgId, 'firstName', e.target.value)}
                            style={{ width: 70, fontSize: 12, fontWeight: 600, color: "#111827", border: "1px solid #e5e7eb", borderRadius: 4, padding: "3px 5px", background: "#fff" }}
                            placeholder="First" />
                        </td>
                        <td style={{ padding: "4px 3px" }}>
                          <input value={c.lastName} onChange={e => updateCandidate(c.msgId, 'lastName', e.target.value)}
                            style={{ width: 80, fontSize: 12, fontWeight: 600, color: "#111827", border: "1px solid #e5e7eb", borderRadius: 4, padding: "3px 5px", background: "#fff" }}
                            placeholder="Last" />
                        </td>
                        <td style={{ padding: "4px 3px", color: "#6b7280", fontSize: 11, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</td>
                        <td style={{ padding: "4px 3px", color: "#6b7280", fontSize: 11 }}>{c.phone || '—'}</td>
                        <td style={{ padding: "4px 3px", textAlign: "center" }}>
                          <select value={c.type} onChange={e => changeCandidateType(c.msgId, e.target.value)}
                            style={{ fontSize: 10, fontWeight: 700, padding: "2px 4px", borderRadius: 4, border: "none",
                              background: typeColor[c.type] || '#6b7280', color: "#fff", cursor: "pointer" }}>
                            <option value="lead">LEAD</option>
                            <option value="active_client">ACTIVE CLIENT</option>
                            <option value="past_client">PAST CLIENT</option>
                            <option value="realtor">REALTOR</option>
                            <option value="lawyer">LAWYER</option>
                          </select>
                        </td>
                        <td style={{ padding: "4px 3px", fontSize: 10, color: "#9ca3af", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.brokerage && `${c.brokerage}`}
                          {c.lawFirm && `${c.lawFirm}`}
                          {c.realtorSource && ` (${c.realtorSource})`}
                          {!c.brokerage && !c.lawFirm && !c.realtorSource && c.subject}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Skipped contacts (collapsible) */}
              {skippedList.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setShowSkipped(!showSkipped)} style={{
                    fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600,
                  }}>
                    {showSkipped ? '▼' : '▶'} {skippedList.length} auto-filtered
                  </button>
                  {showSkipped && (
                    <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 4, fontSize: 11, color: "#9ca3af" }}>
                      {skippedList.map((s, i) => (
                        <div key={i} style={{ padding: "2px 0" }}>
                          <span style={{ color: "#ef4444" }}>✕</span> {s.name || s.email || s.msgId?.slice(0, 8)} — <em>{s.reason}</em>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* APPROVE / SKIP buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={runApprove} disabled={importing || approvedCount === 0} style={{
                  display: "flex", alignItems: "center", gap: 4, background: "#10b981", color: "#fff", border: "none", borderRadius: 6,
                  padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: importing ? "wait" : "pointer",
                  opacity: approvedCount === 0 ? 0.4 : 1,
                }}>
                  {importing ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Importing...</> : <><CheckCircle2 size={12} /> Approve & Import ({approvedCount})</>}
                </button>
                <button onClick={() => { setCandidates([]); setSkippedList([]); setScanResult(null); }} style={{
                  display: "flex", alignItems: "center", gap: 4, background: "transparent", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6,
                  padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>
                  Skip Batch
                </button>
              </div>
            </div>
          )}

          {/* Recent activity */}
          {status?.recentActivity?.length > 0 && candidates.length === 0 && (
            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Recent Imports</div>
              {status.recentActivity.slice(0, 8).map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12 }}>
                  <CheckCircle2 size={11} color={a.isRealtor ? "#f59e0b" : a.isLawyer ? "#6366f1" : "#10b981"} />
                  <strong style={{ color: "#111827" }}>{a.name}</strong>
                  {a.isRealtor && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#f59e0b", padding: "1px 5px", borderRadius: 3 }}>REALTOR</span>}
                  {a.isLawyer && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#6366f1", padding: "1px 5px", borderRadius: 3 }}>LAWYER</span>}
                  {a.email && <span style={{ color: "#9ca3af" }}>{a.email}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Constant for frontend to reference
const TJ_BATCH_SIZE = 1000;

function LeadImportBar() {
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState(() => {
    try {
      const saved = localStorage.getItem('agenthq-lead-import-last');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [expanded, setExpanded] = useState(false);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/fub/leads/scan');
      const data = await res.json();
      const result = { ...data, scannedAt: new Date().toISOString() };
      setLastResult(result);
      setExpanded(true);
      try { localStorage.setItem('agenthq-lead-import-last', JSON.stringify(result)); } catch {}
    } catch (err) {
      console.error('[Lead Import] Scan error:', err);
    }
    setScanning(false);
  };

  const newLeads = lastResult?.leadsCreated?.filter(l => l.status === 'created') || [];
  const existingLeads = lastResult?.leadsCreated?.filter(l => l.status === 'already_exists') || [];
  const notesAdded = lastResult?.notesAdded || [];
  const errors = lastResult?.errors || [];

  return (
    <div style={{ marginBottom: 14, background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px",
        background: newLeads.length > 0 ? "#eff6ff" : "#fafafa",
        cursor: lastResult ? "pointer" : "default",
      }} onClick={() => lastResult && setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Inbox size={14} color="#2563eb" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>Lead Import from Gmail</span>
          {newLeads.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#2563eb", padding: "1px 6px", borderRadius: 3 }}>
              {newLeads.length} new
            </span>
          )}
          {notesAdded.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#8b5cf6", padding: "1px 6px", borderRadius: 3 }}>
              {notesAdded.length} notes
            </span>
          )}
          {lastResult && !expanded && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              Last scan: {new Date(lastResult.scannedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); runScan(); }} disabled={scanning} style={{
          display: "flex", alignItems: "center", gap: 4, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6,
          padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: scanning ? "wait" : "pointer",
        }}>
          <RefreshCw size={11} style={{ animation: scanning ? "spin 1s linear infinite" : "none" }} />
          {scanning ? "Scanning..." : "Scan Gmail"}
        </button>
      </div>

      {expanded && lastResult && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb" }}>
          {newLeads.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 6 }}>New Leads Created in FUB:</div>
              {newLeads.map((l, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12 }}>
                  <CheckCircle2 size={12} color="#10b981" />
                  <strong>{l.name}</strong>
                  {l.phone && <span style={{ color: "#6b7280" }}>{l.phone}</span>}
                  {l.email && <span style={{ color: "#6b7280" }}>{l.email}</span>}
                  {l.source && <span style={{ fontSize: 10, color: "#2563eb", background: "#eff6ff", padding: "1px 5px", borderRadius: 3 }}>{l.source}</span>}
                </div>
              ))}
            </div>
          )}
          {notesAdded.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5b21b6", marginBottom: 6 }}>Notes Added to Contacts:</div>
              {notesAdded.map((n, i) => (
                <div key={i} style={{ marginBottom: 4, fontSize: 12 }}>
                  <CheckCircle2 size={12} color="#8b5cf6" style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                  <strong>{n.contactName}</strong> — <span style={{ color: "#6b7280" }}>{n.notePreview}</span>
                </div>
              ))}
            </div>
          )}
          {existingLeads.length > 0 && (
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
              {existingLeads.length} lead(s) already existed in FUB — skipped.
            </div>
          )}
          {errors.length > 0 && (
            <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 6 }}>
              {errors.length} error(s): {errors.map(e => e.error || e.contactName).join(', ')}
            </div>
          )}
          {lastResult.success && newLeads.length === 0 && notesAdded.length === 0 && errors.length === 0 && (
            <div style={{ fontSize: 12, color: "#9ca3af" }}>No new lead emails found in the last 7 days.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual call card with log/voicemail actions
function CallCard({ c, onLogged }) {
  const cKey = c.fubId || c.id;
  const [mode, setMode] = useState('idle'); // idle | logging | submitting | done | vm_submitting | vm_done
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState(null); // 'connected' | 'no_answer'

  const submitLog = async (callOutcome, callNotes) => {
    setMode(callOutcome === 'no_answer' ? 'vm_submitting' : 'submitting');
    try {
      const res = await fetch('/api/fub/log-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: c.fubId,
          outcome: callOutcome,
          notes: callNotes || '',
          contactName: c.name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMode(callOutcome === 'no_answer' ? 'vm_done' : 'done');
        setOutcome(callOutcome);
        // Remove from list after brief success flash
        setTimeout(() => onLogged(cKey, callOutcome), 1200);
      } else {
        console.error('[FUB] Log call failed:', data.error);
        setMode('idle');
      }
    } catch (err) {
      console.error('[FUB] Log call error:', err);
      setMode('idle');
    }
  };

  // Done/VM done state — green success flash
  if (mode === 'done' || mode === 'vm_done') {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
        background: "#f0fdf4", marginBottom: 4, border: "1px solid #bbf7d0",
        transition: "all 0.3s ease",
      }}>
        <CheckCircle2 size={18} color="#10b981" />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>{c.name}</span>
          <span style={{ fontSize: 11, color: "#10b981", marginLeft: 8 }}>
            {mode === 'vm_done' ? 'Voicemail logged to FUB' : 'Call logged to FUB'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 10, background: mode === 'logging' ? "#fff" : "#fafafa", marginBottom: 4,
      border: mode === 'logging' ? "1px solid #bfdbfe" : "1px solid transparent",
      transition: "all 0.2s ease",
    }}>
      {/* Main contact row */}
      <div style={{ padding: "10px 12px" }}>
        {/* Top row: name + stage + action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{c.name}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: c.tagColor, background: c.tagBg, padding: "1px 6px", borderRadius: 4 }}>{c.fubStage}</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>Last: {c.lastContact}</span>
            </div>
          </div>
          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {mode === 'idle' && (
              <>
                <button onClick={() => setMode('logging')} style={{
                  display: "flex", alignItems: "center", gap: 4, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6,
                  padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                  <PenLine size={11} /> Log Call
                </button>
                <button onClick={() => submitLog('no_answer', '')} disabled={mode === 'vm_submitting'} style={{
                  display: "flex", alignItems: "center", gap: 4, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6,
                  padding: "6px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                  <PhoneOff size={10} /> No Answer
                </button>
              </>
            )}
            {mode === 'vm_submitting' && (
              <span style={{ fontSize: 11, color: "#9ca3af", display: "flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Logging...
              </span>
            )}
            {mode === 'submitting' && (
              <span style={{ fontSize: 11, color: "#2563eb", display: "flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Saving to FUB...
              </span>
            )}
          </div>
        </div>
        {/* Synopsis — Cole's Notes breakdown */}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>{c.context}</div>
        {/* Phone number — below buttons for more room */}
        {c.phone && c.phone !== '—' && (
          <div style={{ marginTop: 4 }}>
            <a href={`tel:${c.phone}`} style={{ fontSize: 12, fontWeight: 600, color: "#2563eb", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Phone size={11} /> {c.phone}
            </a>
          </div>
        )}
      </div>

      {/* Expanded notes panel */}
      {mode === 'logging' && (
        <div style={{ padding: "0 12px 12px", borderTop: "1px solid #e5e7eb", marginTop: 4, paddingTop: 10 }}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Call notes — what did you discuss? Any follow-up needed?"
            autoFocus
            style={{
              width: "100%", minHeight: 70, padding: 10, borderRadius: 8, border: "1px solid #d1d5db",
              fontSize: 12, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setMode('idle'); setNotes(''); }} style={{
              background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6,
              padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              Cancel
            </button>
            <button onClick={() => submitLog('no_answer', notes)} style={{
              display: "flex", alignItems: "center", gap: 4, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6,
              padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              <PhoneOff size={11} /> No Answer, Left VM
            </button>
            <button onClick={() => submitLog('connected', notes)} disabled={!notes.trim()} style={{
              display: "flex", alignItems: "center", gap: 4, background: notes.trim() ? "#10b981" : "#d1d5db", color: "#fff", border: "none", borderRadius: 6,
              padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: notes.trim() ? "pointer" : "not-allowed",
            }}>
              <Check size={11} /> Log Call to FUB
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CallListSection() {
  const { callList: dailyCallList, loading, connected, totalContacts, generatedAt, refresh } = useFubContext();
  const [refreshing, setRefreshing] = useState(false);
  const [loggedIds, setLoggedIds] = useState(() => {
    try {
      const saved = localStorage.getItem('agenthq-calls-logged');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only use today's logged calls
        const todayKey = new Date().toISOString().slice(0, 10);
        if (parsed.dateKey === todayKey) return parsed.ids || {};
        }
    } catch {}
    return {};
  });

  const persistLogged = (updater) => {
    setLoggedIds(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('agenthq-calls-logged', JSON.stringify({
          ids: next, dateKey: new Date().toISOString().slice(0, 10),
        }));
      } catch {}
      return next;
    });
  };

  const handleLogged = (cKey, outcome) => {
    persistLogged(prev => ({ ...prev, [cKey]: outcome }));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const bucketOrder = ["hot", "warm", "cold", "past", "sphere", "active"];
  const bucketLabels = { hot: "Hot Leads", warm: "Warm Leads", cold: "Cold Leads", past: "Past Clients", sphere: "Sphere", active: "Active Clients" };
  const bucketIcons = { hot: Flame, warm: Sun, cold: Snowflake, past: RotateCcw, sphere: Users, active: UserPlus };
  const bucketColors = { hot: "#ef4444", warm: "#f59e0b", cold: "#6b7280", past: "#8b5cf6", sphere: "#06b6d4", active: "#2563eb" };

  // Filter out logged calls
  const activeCallList = dailyCallList.filter(c => !loggedIds[c.fubId || c.id]);
  const loggedCount = Object.keys(loggedIds).length;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Phone size={16} color="#2563eb" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Today's Call List</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 6 }}>{loggedCount}/{dailyCallList.length} done</span>
          {connected && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>}
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={{
          display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#2563eb", cursor: refreshing ? "wait" : "pointer",
        }}>
          <RefreshCw size={11} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
          {refreshing ? "Syncing..." : "Refresh from FUB"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16, padding: "8px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #f3f4f6" }}>
        {connected
          ? <>Scored and ranked from <strong>{totalContacts}</strong> contacts in Follow Up Boss. Log calls below — notes sync directly to FUB.</>
          : <>Set <code>FUB_API_KEY</code> in Railway to connect Follow Up Boss and generate a live call list.</>}
        {generatedAt && <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 8 }}>Generated: {new Date(generatedAt).toLocaleTimeString()}</span>}
      </div>
      <LeadImportBar />
      {loading && dailyCallList.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 13 }}>
          <RefreshCw size={20} style={{ animation: "spin 1s linear infinite", marginBottom: 8 }} /><br />
          Loading call list from Follow Up Boss...
        </div>
      )}
      {!loading && dailyCallList.length === 0 && !connected && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 13 }}>
          Follow Up Boss not connected. Add your FUB_API_KEY to Railway environment variables.
        </div>
      )}
      {!loading && activeCallList.length === 0 && dailyCallList.length > 0 && (
        <div style={{ textAlign: "center", padding: "30px 0", color: "#10b981", fontSize: 14, fontWeight: 600 }}>
          <CheckCircle2 size={24} style={{ marginBottom: 6 }} /><br />
          All {dailyCallList.length} calls completed for today!
        </div>
      )}
      {bucketOrder.map(bucket => {
        const contacts = activeCallList.filter(c => c.bucket === bucket);
        if (contacts.length === 0) return null;
        const BIcon = bucketIcons[bucket];
        return (
          <div key={bucket} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <BIcon size={13} color={bucketColors[bucket]} />
              <span style={{ fontSize: 12, fontWeight: 700, color: bucketColors[bucket], textTransform: "uppercase", letterSpacing: "0.05em" }}>{bucketLabels[bucket]}</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>({contacts.length})</span>
            </div>
            {contacts.map(c => (
              <CallCard key={c.fubId || c.id} c={c} onLogged={handleLogged} />
            ))}
          </div>
        );
      })}
    </Card>
  );
}

// ─────────────────────────────────────────────
// EMAIL EA SECTION — Live Thread State Dashboard
// Per Framework §3.5: Awaiting You / Draft Ready / Awaiting Them / Closed / Snoozed
// ─────────────────────────────────────────────
function EmailEASection() {
  const eaData = useContext(EaContext);
  const { threads: allThreads, counts, status, lastSweep, fubSentTracked, refresh, updateThreadState, deleteThread } = eaData || {};
  const [selectedThread, setSelectedThread] = useState(null);
  const [viewFilter, setViewFilter] = useState('awaiting_you');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (refresh) await refresh();
    setRefreshing(false);
  };

  // Use live threads if available, otherwise fallback
  const isLive = status === 'ok' && allThreads && allThreads.length > 0;
  const threads = isLive
    ? allThreads.filter(t => viewFilter === 'all' || t.state === viewFilter)
    : emailInboxFallback;

  const stateConfig = {
    awaiting_you: { label: 'Awaiting You', color: '#ef4444', bg: '#fef2f2', icon: Reply },
    draft_ready: { label: 'Draft Ready', color: '#2563eb', bg: '#eff6ff', icon: FileText },
    awaiting_them: { label: 'Awaiting Them', color: '#7c3aed', bg: '#f5f3ff', icon: Clock },
    closed: { label: 'Closed', color: '#10b981', bg: '#ecfdf5', icon: CheckCircle2 },
    snoozed: { label: 'Snoozed', color: '#f59e0b', bg: '#fffbeb', icon: Timer },
  };

  const priorityBadge = { p0: { label: 'P0', color: '#ef4444', bg: '#fef2f2' }, p1: { label: 'P1', color: '#f59e0b', bg: '#fffbeb' }, p2: null };
  const categoryLabel = { brokerbay: 'BrokerBay', crm_lead: 'FUB Lead', deal_tracker: 'Sisu', listing_alert: 'REALM', automation: 'Automation', team: 'Faris Team', transaction: 'Transaction', showing: 'Showing', listing: 'Listing', important: 'Important', general: '' };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Mail size={16} color="#c8a96e" />
        <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", flex: 1 }}>Email AI</span>
        {isLive && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 3 }}>LIVE</span>}
        {!isLive && status !== 'loading' && <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "#fef2f2", padding: "2px 6px", borderRadius: 3 }}>DISCONNECTED</span>}
        {(fubSentTracked > 0 || eaData?.outlookCcForwards > 0) && <span style={{ fontSize: 9, color: "#7c3aed", background: "#f5f3ff", padding: "2px 6px", borderRadius: 3, fontWeight: 600 }}>Outlook: {eaData?.outlookCcForwards || 0} sent tracked</span>}
        <button onClick={handleRefresh} disabled={refreshing} style={{ fontSize: 10, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
          {refreshing ? 'Sweeping...' : 'Sweep Now'}
        </button>
      </div>

      {/* State filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {Object.entries(stateConfig).map(([key, cfg]) => {
          const count = counts?.[key] || 0;
          const active = viewFilter === key;
          const CIcon = cfg.icon;
          return (
            <button key={key} onClick={() => setViewFilter(key)} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8,
              background: active ? cfg.color : cfg.bg, color: active ? "#fff" : cfg.color,
              border: `1px solid ${cfg.color}${active ? '' : '30'}`, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              <CIcon size={12} />
              <span>{count}</span>
              <span style={{ fontWeight: 400 }}>{cfg.label}</span>
            </button>
          );
        })}
        <button onClick={() => setViewFilter('all')} style={{
          padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: viewFilter === 'all' ? '#111827' : '#f3f4f6', color: viewFilter === 'all' ? '#fff' : '#6b7280',
          border: viewFilter === 'all' ? '1px solid #111827' : '1px solid #e5e7eb',
        }}>All</button>
      </div>

      {/* Thread list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {threads.length === 0 && !isLive && status !== 'loading' && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <AlertTriangle size={24} color="#f59e0b" style={{ margin: "0 auto 10px" }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Gmail disconnected</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Use the Reconnect to Google banner at the top of the page.</div>
          </div>
        )}
        {threads.length === 0 && isLive && (
          <div style={{ textAlign: "center", padding: 30, color: "#9ca3af", fontSize: 13 }}>
            {viewFilter === 'awaiting_you' ? 'Inbox zero — nothing awaiting your reply.' : `No threads in "${stateConfig[viewFilter]?.label || viewFilter}".`}
          </div>
        )}
        {threads.slice(0, 25).map(t => {
          const tid = t.threadId || t.id;
          const isSelected = selectedThread === tid;
          const sc = stateConfig[t.state] || stateConfig.awaiting_you;
          const pb = priorityBadge[t.priority];

          return (
            <div key={tid}>
              <div onClick={() => setSelectedThread(isSelected ? null : tid)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                background: isSelected ? "#eff6ff" : t.state === 'closed' ? "#f0fdf4" : t.state === 'awaiting_you' ? "#fef2f2" : "#fafafa",
                border: isSelected ? "1px solid #bfdbfe" : "1px solid transparent",
                opacity: t.state === 'closed' ? 0.6 : 1,
              }}>
                <div style={{ width: 4, height: 30, borderRadius: 2, background: sc.color, flexShrink: 0 }} />
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: sc.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: sc.color }}>{(t.from || '?').charAt(0)}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{t.from || 'Unknown'}</span>
                    {!t.isRead && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }} />}
                    {pb && <span style={{ fontSize: 8, fontWeight: 700, color: pb.color, background: pb.bg, padding: "1px 5px", borderRadius: 3 }}>{pb.label}</span>}
                    {t.category && categoryLabel[t.category] && <span style={{ fontSize: 9, color: "#6b7280", background: "#f3f4f6", padding: "1px 5px", borderRadius: 3 }}>{categoryLabel[t.category]}</span>}
                    {t.fubSentMatch && <span style={{ fontSize: 8, fontWeight: 600, color: "#7c3aed", background: "#f5f3ff", padding: "1px 5px", borderRadius: 3 }}>via FUB</span>}
                    {t.outlookCcDetected && <span style={{ fontSize: 8, fontWeight: 600, color: "#2563eb", background: "#eff6ff", padding: "1px 5px", borderRadius: 3 }}>Outlook CC</span>}
                    {t.outlookScrapeMatch && <span style={{ fontSize: 8, fontWeight: 600, color: "#059669", background: "#ecfdf5", padding: "1px 5px", borderRadius: 3 }}>Outlook Sent</span>}
                    {t.messageCount > 1 && <span style={{ fontSize: 9, color: "#9ca3af" }}>({t.messageCount})</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.subject}</div>
                </div>
                <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap", flexShrink: 0 }}>{t.lastDate ? new Date(t.lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : t.time || ''}</span>
                {/* Quick Done button — visible without expanding */}
                {t.state !== 'closed' && (
                  <button onClick={(e) => { e.stopPropagation(); updateThreadState?.(tid, 'closed'); setSelectedThread(null); }} style={{ display: "flex", alignItems: "center", gap: 3, background: "#10b981", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0, transition: "opacity 0.15s" }} onMouseEnter={e => e.currentTarget.style.opacity = '0.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                    <CheckCircle2 size={11} /> Done
                  </button>
                )}
                {/* Delete — trash in Gmail + remove from dashboard */}
                <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this email from Gmail?')) { deleteThread?.(tid); setSelectedThread(null); } }} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, background: "none", color: "#d1d5db", border: "none", borderRadius: 6, cursor: "pointer", flexShrink: 0, transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2'; }} onMouseLeave={e => { e.currentTarget.style.color = '#d1d5db'; e.currentTarget.style.background = 'none'; }} title="Delete from Gmail">
                  <X size={13} />
                </button>
                {isSelected ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
              </div>

              {/* Expanded thread actions */}
              {isSelected && (
                <div style={{ marginLeft: 16, marginTop: 4, background: "#f8fafc", borderRadius: 10, padding: 14, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>{t.snippet}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {t.state === 'awaiting_you' && (
                      <>
                        <button onClick={() => updateThreadState?.(tid, 'awaiting_them')} style={{ display: "flex", alignItems: "center", gap: 4, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Reply size={11} /> Mark Replied</button>
                        <button onClick={() => updateThreadState?.(tid, 'snoozed', new Date(Date.now() + 24*60*60*1000).toISOString())} style={{ display: "flex", alignItems: "center", gap: 4, background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Timer size={11} /> Snooze 24h</button>
                      </>
                    )}
                    {t.state !== 'closed' && (
                      <button onClick={() => { updateThreadState?.(tid, 'closed'); setSelectedThread(null); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "#10b981", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><CheckCircle2 size={11} /> Done</button>
                    )}
                    {t.state === 'closed' && (
                      <button onClick={() => updateThreadState?.(tid, 'awaiting_you')} style={{ display: "flex", alignItems: "center", gap: 4, background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Reply size={11} /> Reopen</button>
                    )}
                    <a href={`https://mail.google.com/mail/u/0/#inbox/${tid}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", textDecoration: "none" }}><ExternalLink size={11} /> Open in Gmail</a>
                    <button onClick={() => { if (window.confirm('Delete this email from Gmail?')) { deleteThread?.(tid); setSelectedThread(null); } }} style={{ display: "flex", alignItems: "center", gap: 4, background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Trash2 size={11} /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sweep info */}
      {lastSweep && (
        <div style={{ marginTop: 10, fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
          Last sweep: {new Date(lastSweep).toLocaleTimeString()} · Auto-refreshes every 5 min
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// HOOK: Live Gmail Activity
// Scans inbox, sent mail, BrokerBay emails — cross-references everything
// ─────────────────────────────────────────────
function useGmailActivity() {
  const [gmailStatus, setGmailStatus] = useState({ connected: false });
  const [activity, setActivity] = useState(null);
  const [brokerBay, setBrokerBay] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Check Gmail connection status
        const statusRes = await fetch('/api/gmail/status');
        const statusData = await statusRes.json();
        setGmailStatus(statusData);

        if (!statusData.connected) {
          setLoading(false);
          return;
        }

        // Fetch activity and BrokerBay data in parallel
        const [actRes, bbRes] = await Promise.all([
          fetch('/api/gmail/activity?days=7'),
          fetch('/api/gmail/brokerbay?days=30'),
        ]);

        const actData = await actRes.json();
        const bbData = await bbRes.json();

        if (actData.status === 'ok') setActivity(actData);
        if (bbData.status === 'ok') setBrokerBay(bbData);
      } catch (err) {
        console.error('[Gmail] Hook error:', err);
      }
      setLoading(false);
    })();
  }, []);

  return { gmailStatus, activity, brokerBay, loading };
}

// ─────────────────────────────────────────────
// GMAIL ACTIVITY PANEL — shows sent email tracking + awaiting replies
// ─────────────────────────────────────────────
function GmailActivityPanel() {
  const { gmailStatus, activity, brokerBay, loading } = useGmailActivity();
  const [tab, setTab] = useState('awaiting'); // awaiting | sent | brokerbay

  if (loading) {
    return (
      <Card>
        <SectionHeader title="Gmail Activity" />
        <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
          Scanning your Gmail...
        </div>
      </Card>
    );
  }

  if (!gmailStatus.connected) {
    return (
      <Card>
        <SectionHeader title="Gmail Activity" />
        <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
          Gmail not connected. Connect your Google account to enable email scanning.
        </div>
      </Card>
    );
  }

  const tabs = [
    { id: 'awaiting', label: `Awaiting Reply (${activity?.awaitingReply?.length || 0})` },
    { id: 'sent', label: `Waiting On (${activity?.waitingOn?.length || 0})` },
    { id: 'brokerbay', label: `BrokerBay (${brokerBay?.summary?.totalEmails || 0})` },
  ];

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60 * 60 * 1000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SectionHeader title="Gmail Intelligence" count={activity?.totalActivity} />
        <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: '#10b981', padding: '2px 6px', borderRadius: 3, marginTop: -4 }}>LIVE</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (tab === t.id ? '#3b82f6' : '#e5e7eb'),
            background: tab === t.id ? '#eff6ff' : '#fff', color: tab === t.id ? '#1d4ed8' : '#6b7280',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Awaiting Your Reply */}
      {tab === 'awaiting' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(activity?.awaitingReply || []).length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              <CheckCircle2 size={20} style={{ margin: '0 auto 6px' }} /> All caught up — no one waiting on you.
            </div>
          ) : (
            (activity?.awaitingReply || []).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#ef444418', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444' }}>{c.name?.charAt(0) || '?'}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{c.email}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>Needs reply</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>{formatTimestamp(c.lastReceived)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* You're Waiting On */}
      {tab === 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(activity?.waitingOn || []).length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>No pending follow-ups.</div>
          ) : (
            (activity?.waitingOn || []).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f59e0b18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b' }}>{c.name?.charAt(0) || '?'}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{c.email}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>Waiting on them</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>Sent {formatTimestamp(c.lastSent)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* BrokerBay Summary */}
      {tab === 'brokerbay' && brokerBay && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ padding: '10px', borderRadius: 8, background: '#ecfdf5', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{brokerBay.summary?.confirmedShowings || 0}</div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Confirmed</div>
            </div>
            <div style={{ padding: '10px', borderRadius: 8, background: '#fef2f2', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#dc2626' }}>{brokerBay.summary?.cancelledShowings || 0}</div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Cancelled</div>
            </div>
            <div style={{ padding: '10px', borderRadius: 8, background: '#fffbeb', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b' }}>{brokerBay.summary?.requestedShowings || 0}</div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Pending</div>
            </div>
          </div>

          {/* Cancelled showings alert */}
          {(brokerBay.showings?.cancelled || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>CANCELLED SHOWINGS</div>
              {brokerBay.showings.cancelled.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 4 }}>
                  <Trash2 size={12} color="#dc2626" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', textDecoration: 'line-through' }}>{s.address}</div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{s.showingDate || ''} {s.showingTime || ''} — {s.agentName || 'Agent TBD'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent confirmed */}
          {(brokerBay.showings?.confirmed || []).length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', marginBottom: 6 }}>RECENT CONFIRMED</div>
              {brokerBay.showings.confirmed.slice(0, 5).map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: '#f0fdf4', marginBottom: 3 }}>
                  <CheckCircle2 size={12} color="#16a34a" />
                  <div style={{ fontSize: 12, color: '#111827' }}>{s.address}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>{s.showingDate || ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// CALENDAR SECTION
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// CALENDAR SECTION (personal + work events, no showings)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// HOOK: Live Google Calendar Connection
// ─────────────────────────────────────────────
function useGoogleCalendar() {
  const [gcalStatus, setGcalStatus] = useState({ connected: false, configured: false, reason: 'Checking...' });
  const [gcalEvents, setGcalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/calendar/status');
      const data = await res.json();
      setGcalStatus(data);
      return data.connected;
    } catch {
      setGcalStatus({ connected: false, configured: false, reason: 'Server unavailable' });
      return false;
    }
  };

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/calendar/events');
      if (res.ok) {
        const data = await res.json();
        setGcalEvents(data.events || []);
      }
    } catch { /* silent */ }
  };

  const refresh = async () => {
    setRefreshing(true);
    const connected = await checkStatus();
    if (connected) await fetchEvents();
    setRefreshing(false);
  };

  // Initial load + check for OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      window.history.replaceState({}, '', '/');
    }

    (async () => {
      const connected = await checkStatus();
      if (connected) await fetchEvents();
      setLoading(false);
    })();

    // Auto-check status every 5 minutes
    const interval = setInterval(async () => {
      const connected = await checkStatus();
      if (connected) await fetchEvents();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const reconnect = () => { window.location.href = '/api/auth/google'; };

  return { gcalStatus, gcalEvents, loading, refreshing, refresh, reconnect };
}

function CalendarSection() {
  const { gcalStatus, gcalEvents, loading, refreshing, refresh, reconnect } = useGoogleCalendar();

  // Color mapping for event types
  const getEventColor = (ev) => {
    const title = (ev.title || '').toLowerCase();
    if (title.includes('showing') || title.includes('brokerbay')) return '#e11d48';
    if (title.includes('listing') || title.includes('open house')) return '#2563eb';
    if (title.includes('closing') || title.includes('offer')) return '#059669';
    if (title.includes('call') || title.includes('meeting')) return '#7c3aed';
    return '#d97706';
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto' });
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
          Today's Calendar {gcalEvents.length > 0 && <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>({gcalEvents.length})</span>}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {gcalStatus.connected && (
            <button onClick={refresh} disabled={refreshing} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b7280", padding: "4px 8px", borderRadius: 6 }}>
              <RefreshCw size={12} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} /> {refreshing ? "Syncing..." : "Refresh"}
            </button>
          )}
          <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>Open GCal →</a>
        </div>
      </div>

      {/* Connection status — reconnect banner is at page top */}
      {!gcalStatus.connected && !loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 6, background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 12 }}>
          <AlertTriangle size={13} color="#d97706" />
          <span style={{ fontSize: 11, color: "#92400e" }}>Google disconnected — use the banner at the top to reconnect.</span>
        </div>
      )}

      {/* Connected indicator */}
      {gcalStatus.connected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "6px 10px", borderRadius: 6, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>Google Calendar connected</span>
          <span style={{ fontSize: 10, color: "#15803d", marginLeft: "auto" }}>Auto-refresh active</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: "20px 0", color: "#9ca3af", fontSize: 12 }}>
          Checking calendar connection...
        </div>
      )}

      {/* Live Google Calendar Events */}
      {gcalStatus.connected && gcalEvents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Calendar size={11} color="#2563eb" /> Google Calendar
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
          </div>
          {gcalEvents.map((ev, i) => {
            const color = getEventColor(ev);
            return (
              <div key={ev.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "#fafafa" }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: color, flexShrink: 0 }} />
                <div style={{ width: 30, height: 30, borderRadius: 8, background: color + "15", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Calendar size={14} color={color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{ev.title}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>
                    {ev.allDay ? "All day" : `${formatTime(ev.start)} — ${formatTime(ev.end)}`}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                {ev.htmlLink && (
                  <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer" style={{ color: "#9ca3af" }}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No events */}
      {gcalStatus.connected && gcalEvents.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "16px 0", color: "#9ca3af", fontSize: 12 }}>
          No Google Calendar events today
        </div>
      )}

      {/* Fallback: Hardcoded events when disconnected */}
      {!gcalStatus.connected && !loading && todayCalendar.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {todayCalendar.map((ev, i) => {
            const EvIcon = ev.icon;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "#fafafa" }}>
                <div style={{ width: 3, height: 36, borderRadius: 2, background: ev.color, flexShrink: 0 }} />
                <div style={{ width: 30, height: 30, borderRadius: 8, background: ev.color + "15", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <EvIcon size={14} color={ev.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{ev.title}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{ev.time} — {ev.end}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: ev.color, background: ev.color + "12", padding: "3px 8px", borderRadius: 4, textTransform: "capitalize" }}>{ev.type}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Showings merged into calendar view */}
      {brokerBayShowings.filter(s => s.date === "Today" && s.status !== "cancelled").length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e11d48", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <MapPin size={11} color="#e11d48" /> Today's Showings
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
          </div>
          {brokerBayShowings.filter(s => s.date === "Today" && s.status !== "cancelled").map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecdd3", marginBottom: 4 }}>
              <div style={{ width: 3, height: 36, borderRadius: 2, background: "#e11d48", flexShrink: 0 }} />
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "#e11d4815", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MapPin size={14} color="#e11d48" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{s.property}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.time} — {s.end} &middot; {s.buyerAgent}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: s.status === "completed" ? "#2563eb" : "#059669", background: s.status === "completed" ? "#eff6ff" : "#ecfdf5", padding: "3px 8px", borderRadius: 4, textTransform: "capitalize" }}>{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// SHOWINGS SECTION (dedicated BrokerBay view)
// ─────────────────────────────────────────────
function ShowingsSection() {
  const [showTab, setShowTab] = useState("upcoming");
  const [expandedShowing, setExpandedShowing] = useState(null);
  const { showings: liveShowings, syncStatus: liveSyncStatus, loading } = useBrokerBayShowings();

  // Update module-level refs so other components (morning snapshot, calendar) can access
  brokerBayShowings = liveShowings;
  brokerBaySyncStatus = liveSyncStatus;

  const statusStyles = {
    confirmed: { color: "#059669", bg: "#ecfdf5", label: "Confirmed" },
    completed: { color: "#2563eb", bg: "#eff6ff", label: "Completed" },
    pending: { color: "#d97706", bg: "#fffbeb", label: "Pending" },
    requested: { color: "#7c3aed", bg: "#f5f3ff", label: "Requested" },
    cancelled: { color: "#dc2626", bg: "#fef2f2", label: "Cancelled" },
  };

  const listingShowings = liveShowings.filter(s => s.role === "listing_agent");
  const buyerShowings = liveShowings.filter(s => s.role === "buyer_agent");

  const showTabs = [
    { id: "upcoming", label: "Upcoming" },
    { id: "all", label: `All (${liveSyncStatus.totalShowingsThisWeek})` },
    { id: "sync", label: "Sync" },
  ];

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>Showings</h3>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: liveSyncStatus.connected ? "#10b981" : "#ef4444" }} />
          <span style={{ fontSize: 10, color: "#6b7280" }}>BrokerBay {liveSyncStatus.lastSync}</span>
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 20, fontSize: 12, color: "#9ca3af" }}>Loading showings from Gmail...</div>}

      {/* Quick stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Listings", val: listingShowings.filter(s => s.status !== "cancelled").length, color: "#8b5cf6", bg: "#f5f3ff" },
          { label: "Buyer", val: buyerShowings.filter(s => s.status !== "cancelled").length, color: "#059669", bg: "#ecfdf5" },
          { label: "Confirmed", val: liveSyncStatus.confirmedCount, color: "#2563eb", bg: "#eff6ff" },
          { label: "Cancelled", val: liveSyncStatus.cancelledCount || 0, color: "#dc2626", bg: "#fef2f2" },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: s.bg, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
        {showTabs.map(t => (
          <button key={t.id} onClick={() => setShowTab(t.id)} style={{
            flex: 1, padding: "7px 10px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: showTab === t.id ? "#fff" : "transparent", color: showTab === t.id ? "#111827" : "#6b7280",
            boxShadow: showTab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── UPCOMING SHOWINGS — split by Listings / Buyers ── */}
      {showTab === "upcoming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* LISTING SHOWINGS */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: 0.5 }}>Your Listings</div>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#8b5cf6", background: "#f5f3ff", padding: "1px 6px", borderRadius: 4 }}>{listingShowings.length}</span>
            </div>
            {listingShowings.length === 0 ? (
              <div style={{ fontSize: 12, color: "#9ca3af", padding: "12px 14px", background: "#f9fafb", borderRadius: 10, textAlign: "center" }}>No listing showings scheduled</div>
            ) : (
              listingShowings.map(s => {
                const st = statusStyles[s.status] || { color: "#6b7280", bg: "#f3f4f6", label: s.status };
                const isExp = expandedShowing === s.id;
                return (
                  <div key={s.id} style={{ marginBottom: 6 }}>
                    <div onClick={() => setExpandedShowing(isExp ? null : s.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: "#fff", border: "1px solid #ede9fe", cursor: "pointer" }}>
                      <div style={{ width: 4, height: 40, borderRadius: 2, background: "#8b5cf6", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{s.property}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{s.date} &middot; {s.time} — {s.end}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{s.buyerAgent} viewing your listing</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.bg, padding: "3px 8px", borderRadius: 4 }}>{st.label}</span>
                      <ChevronDown size={12} color="#9ca3af" style={{ transform: isExp ? "rotate(180deg)" : "none" }} />
                    </div>
                    {isExp && (
                      <div style={{ margin: "4px 0 0 18px", padding: 12, background: "#faf8ff", borderRadius: 10, border: "1px solid #ede9fe", fontSize: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <div><span style={{ color: "#9ca3af" }}>Buyer agent:</span> <span style={{ fontWeight: 600 }}>{s.buyerAgent}</span></div>
                          <div><span style={{ color: "#9ca3af" }}>Lockbox:</span> <span style={{ fontWeight: 600 }}>{s.lockboxCode}</span></div>
                          <div><span style={{ color: "#9ca3af" }}>Requested by:</span> <span style={{ fontWeight: 600 }}>{s.requestedBy}</span></div>
                        </div>
                        {s.notes && <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff", borderRadius: 6, color: "#374151" }}>{s.notes}</div>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* DIVIDER */}
          <div style={{ borderTop: "1px solid #e5e7eb", margin: "4px 0" }} />

          {/* BUYER SHOWINGS */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: 0.5 }}>Buyer Showings</div>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "#ecfdf5", padding: "1px 6px", borderRadius: 4 }}>{buyerShowings.length}</span>
            </div>
            {buyerShowings.length === 0 ? (
              <div style={{ fontSize: 12, color: "#9ca3af", padding: "12px 14px", background: "#f9fafb", borderRadius: 10, textAlign: "center" }}>No buyer showings scheduled</div>
            ) : (
              buyerShowings.map(s => {
                const st = statusStyles[s.status] || { color: "#6b7280", bg: "#f3f4f6", label: s.status };
                const isExp = expandedShowing === s.id;
                return (
                  <div key={s.id} style={{ marginBottom: 6 }}>
                    <div onClick={() => setExpandedShowing(isExp ? null : s.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: "#fff", border: "1px solid #d1fae5", cursor: "pointer" }}>
                      <div style={{ width: 4, height: 40, borderRadius: 2, background: "#059669", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{s.property}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{s.date} &middot; {s.time} — {s.end}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>You as buyer agent</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.bg, padding: "3px 8px", borderRadius: 4 }}>{st.label}</span>
                      <ChevronDown size={12} color="#9ca3af" style={{ transform: isExp ? "rotate(180deg)" : "none" }} />
                    </div>
                    {isExp && (
                      <div style={{ margin: "4px 0 0 18px", padding: 12, background: "#f0fdf4", borderRadius: 10, border: "1px solid #d1fae5", fontSize: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <div><span style={{ color: "#9ca3af" }}>Listing agent:</span> <span style={{ fontWeight: 600 }}>{s.sellerName}</span></div>
                          <div><span style={{ color: "#9ca3af" }}>Lockbox:</span> <span style={{ fontWeight: 600 }}>{s.lockboxCode}</span></div>
                        </div>
                        {s.notes && <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff", borderRadius: 6, color: "#374151" }}>{s.notes}</div>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── ALL SHOWINGS ── */}
      {showTab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {liveShowings.map(s => {
            const st = statusStyles[s.status] || { color: "#6b7280", bg: "#f3f4f6", label: s.status };
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "#fff", border: "1px solid #f0f0f0" }}>
                <div style={{ width: 4, height: 36, borderRadius: 2, background: "#e11d48", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{s.property}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.date} &middot; {s.time}{s.end ? ` — ${s.end}` : ''} &middot; {s.buyerAgent}{s.brokerage ? ` (${s.brokerage})` : ''}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: s.role === "listing_agent" ? "#8b5cf6" : "#6b7280", background: s.role === "listing_agent" ? "#f5f3ff" : "#f3f4f6", padding: "2px 6px", borderRadius: 3 }}>{s.role === "listing_agent" ? "Listing" : "Buyer"}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 4 }}>{st.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SYNC STATUS ── */}
      {showTab === "sync" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: 12, background: "linear-gradient(135deg, #ecfdf5, #f0fdf4)", border: "1px solid #bbf7d0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={18} color="#059669" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>BrokerBay Connected</div>
                <div style={{ fontSize: 11, color: "#059669" }}>Emails parsed from Gmail in real time</div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
            <div style={{ padding: "10px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}>Last Sync</div>
              <div style={{ fontWeight: 600, color: "#111827" }}>{liveSyncStatus.lastSync}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}>Total Active</div>
              <div style={{ fontWeight: 600, color: "#111827" }}>{liveSyncStatus.totalShowingsThisWeek} showings</div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// TOP PRIORITIES OF THE DAY (drag to reorder)
// ─────────────────────────────────────────────
function TopPriorities() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [completing, setCompleting] = useState(null);
  const [doneCount, setDoneCount] = useState(0);
  const [doneIds, setDoneIds] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [source, setSource] = useState('');
  const [lastGenerated, setLastGenerated] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  // Tier colours: top 3 orange, next 3 yellow, rest green
  const tierColor = (idx) => {
    if (idx < 3) return { bg: '#fff7ed', border: '#fed7aa', accent: '#ea580c', badge: '#ea580c', badgeBg: '#fff7ed', label: 'DO NOW' };
    if (idx < 6) return { bg: '#fefce8', border: '#fef08a', accent: '#ca8a04', badge: '#ca8a04', badgeBg: '#fefce8', label: 'UP NEXT' };
    return { bg: '#f0fdf4', border: '#bbf7d0', accent: '#16a34a', badge: '#16a34a', badgeBg: '#f0fdf4', label: 'GROWTH' };
  };

  // Load saved state, then auto-generate if empty
  useEffect(() => {
    (async () => {
      let stateLoaded = false;
      try {
        const res = await fetch('/api/tasks');
        const { state } = await res.json();
        if (state && state.priorities && state.priorities.length > 0 && state.savedAt) {
          setTasks(state.priorities);
          setDoneCount(state.doneCount || 0);
          setDoneIds(state.doneIds || []);
          setSource(state.source || 'saved');
          setLastGenerated(state.generatedAt || state.savedAt);
          stateLoaded = true;
        }
      } catch {}
      if (!stateLoaded) {
        // Auto-generate on first load if nothing saved
        await generatePriorities();
      }
      setLoaded(true);
    })();
  }, []);

  // Save state whenever tasks change
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      const payload = { priorities: tasks, doneCount, doneIds, source, generatedAt: lastGenerated, savedAt: new Date().toISOString() };
      fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [tasks, doneCount, doneIds, loaded]);

  const generatePriorities = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/priorities/generate');
      const data = await res.json();
      if (data.status === 'ok' && data.priorities?.length > 0) {
        setTasks(data.priorities);
        setSource(data.source);
        setLastGenerated(data.generatedAt);
        setDoneCount(0);
        setDoneIds([]);
      }
    } catch (e) {
      console.error('[Priorities] Generate error:', e);
    }
    setGenerating(false);
  };

  const markDone = (id) => {
    setCompleting(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true } : t));
    setTimeout(() => {
      setDoneCount(c => c + 1);
      setDoneIds(prev => [...prev, id]);
      setTasks(prev => prev.filter(t => t.id !== id));
      setCompleting(null);
    }, 600);
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    const task = { id: Date.now(), text: newTask, done: false, category: "task", categoryColor: "#6b7280", rank: tasks.length + 1 };
    setTasks(prev => [...prev, task]);
    setNewTask("");
  };

  const removeTask = (id) => setTasks(prev => prev.filter(t => t.id !== id));

  // Drag handlers
  const handleDragStart = (idx) => { setDragFrom(idx); };
  const handleDragEnter = (idx) => { setDragOver(idx); };
  const handleDragEnd = () => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      setTasks(prev => {
        const items = [...prev];
        const [moved] = items.splice(dragFrom, 1);
        items.splice(dragOver, 0, moved);
        return items;
      });
    }
    setDragFrom(null);
    setDragOver(null);
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    setTasks(prev => { const items = [...prev]; [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]]; return items; });
  };
  const moveDown = (idx) => {
    if (idx >= tasks.length - 1) return;
    setTasks(prev => { const items = [...prev]; [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]]; return items; });
  };

  const activeTasks = tasks.filter(t => !t.done);
  const totalTasks = activeTasks.length + doneCount;
  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return (
    <Card>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#fff7ed,#fefce8)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #fed7aa" }}>
            <Target size={16} color="#ea580c" />
          </div>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
              Today's Priorities
              {source === 'claude' && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: '#ea580c', padding: '2px 6px', borderRadius: 3, marginLeft: 8, verticalAlign: 'middle' }}>AI</span>}
            </h3>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Ranked by impact. Drag to reorder. Never stop moving forward.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 60, height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${progressPct}%`, height: "100%", background: "#ea580c", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#ea580c" }}>{doneCount}/{totalTasks}</span>
          <button onClick={generatePriorities} disabled={generating} style={{
            fontSize: 10, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline",
          }}>
            {generating ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'Regenerate'}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {generating && activeTasks.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
          <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Analyzing your business data...</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Scanning FUB contacts, emails, calendar, and showings</div>
        </div>
      )}

      {/* Tiered task list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {activeTasks.map((task, idx) => {
          const tier = tierColor(idx);
          const prevTier = idx > 0 ? tierColor(idx - 1) : null;
          const showTierLabel = idx === 0 || tier.label !== prevTier?.label;

          return (
            <div key={task.id}>
              {/* Tier separator label */}
              {showTierLabel && (
                <div style={{ fontSize: 9, fontWeight: 800, color: tier.accent, letterSpacing: '0.08em', padding: '8px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 2, background: tier.accent, borderRadius: 1 }} />
                  {tier.label}
                  <div style={{ flex: 1, height: 1, background: tier.border }} />
                </div>
              )}
              <div
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
                  background: dragOver === idx && dragFrom !== idx ? "#eff6ff" : tier.bg,
                  border: `1px solid ${dragOver === idx && dragFrom !== idx ? '#93c5fd' : tier.border}`,
                  boxShadow: dragFrom === idx ? "0 4px 12px rgba(0,0,0,0.1)" : "0 1px 2px rgba(0,0,0,0.03)",
                  opacity: completing === task.id ? 0.4 : dragFrom === idx ? 0.5 : 1,
                  transform: completing === task.id ? "scale(0.97)" : "none",
                  cursor: "grab", transition: "all 0.15s ease", userSelect: "none",
                }}
              >
                {/* Drag handle */}
                <div style={{ display: "flex", flexDirection: "column", gap: 1, cursor: "grab", padding: "4px 2px", flexShrink: 0 }}>
                  {[0,1,2].map(r => (
                    <div key={r} style={{ display: "flex", gap: 2 }}>
                      <div style={{ width: 3, height: 3, borderRadius: "50%", background: tier.accent + '60' }} />
                      <div style={{ width: 3, height: 3, borderRadius: "50%", background: tier.accent + '60' }} />
                    </div>
                  ))}
                </div>

                {/* Rank number */}
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", background: tier.accent,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>{idx + 1}</span>
                </div>

                {/* Task text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: idx < 3 ? 700 : 500, color: "#111827", lineHeight: 1.3 }}>{task.text}</div>
                </div>

                {/* Category tag */}
                <span style={{ fontSize: 8, fontWeight: 700, color: task.categoryColor || tier.accent, background: (task.categoryColor || tier.accent) + '12', padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em", flexShrink: 0, whiteSpace: 'nowrap' }}>{task.category}</span>

                {/* Reorder arrows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0 }}>
                  <button onClick={() => moveUp(idx)} disabled={idx === 0} style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#e5e7eb" : "#9ca3af", padding: "1px 3px", lineHeight: 0 }}>
                    <ChevronUp size={12} />
                  </button>
                  <button onClick={() => moveDown(idx)} disabled={idx >= activeTasks.length - 1} style={{ background: "none", border: "none", cursor: idx >= activeTasks.length - 1 ? "default" : "pointer", color: idx >= activeTasks.length - 1 ? "#e5e7eb" : "#9ca3af", padding: "1px 3px", lineHeight: 0 }}>
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Done button */}
                <button onClick={() => markDone(task.id)} disabled={completing === task.id} style={{
                  background: "#f3f4f6", border: "none", borderRadius: 6,
                  padding: "4px 10px", fontSize: 10, cursor: "pointer",
                  color: "#6b7280", fontWeight: 600, transition: "all 0.15s",
                }}>Done</button>

                {/* Remove */}
                <button onClick={() => removeTask(task.id)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", padding: 3 }} title="Remove">
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add custom task */}
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="Add a task..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, outline: "none" }} />
        <button onClick={addTask} style={{
          background: "#ea580c", color: "#fff", border: "none", borderRadius: 8,
          padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <PenLine size={11} /> Add
        </button>
      </div>

      {/* Footer */}
      {lastGenerated && (
        <div style={{ marginTop: 8, fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
          Generated {new Date(lastGenerated).toLocaleTimeString()} · {source === 'claude' ? 'AI-powered' : 'Rule-based'} · {activeTasks.length} active tasks
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────
// MARKETING — BUFFER INTEGRATION
// ─────────────────────────────────────────────
const bufferChannels = [
  { id: "ch_ig", name: "jonathanwallacerealestate", service: "instagram", icon: "📸", color: "#E1306C", followers: 1842, growth: "+38", growthPct: "+2.1%", connected: true },
  { id: "ch_li", name: "Jonathan Wallace", service: "linkedin", icon: "💼", color: "#0A66C2", followers: 623, growth: "+17", growthPct: "+2.8%", connected: true },
  { id: "ch_gb", name: "Jonathan Wallace — Georgian Bay Realty", service: "google_business", icon: "📍", color: "#4285F4", followers: null, growth: null, growthPct: null, connected: true, reviews: 47, avgRating: 4.9 },
];

const bufferMetrics = {
  reach: { value: "12.4K", change: "+18%", trend: "up", period: "vs last 30 days" },
  impressions: { value: "31.2K", change: "+12%", trend: "up", period: "vs last 30 days" },
  engagementRate: { value: "4.7%", change: "+0.6%", trend: "up", period: "vs last 30 days" },
  linkClicks: { value: "284", change: "+22%", trend: "up", period: "vs last 30 days" },
  profileVisits: { value: "1,205", change: "+9%", trend: "up", period: "vs last 30 days" },
};

const recentPosts = [
  { id: 1, channel: "instagram", thumb: "🏡", caption: "Just listed — Stunning waterfront on Georgian Bay. 4 bed, 3 bath, panoramic views...", likes: 87, comments: 14, shares: 6, date: "Apr 14", status: "sent", engRate: "5.8%" },
  { id: 2, channel: "instagram", thumb: "🔑", caption: "SOLD! Congratulations to the Morrison family on their new home in Midland...", likes: 124, comments: 23, shares: 11, date: "Apr 12", status: "sent", engRate: "8.6%" },
  { id: 3, channel: "instagram", thumb: "📊", caption: "Q1 Georgian Bay Market Update — Inventory is low, demand is high. Here's what sellers need to know...", likes: 61, comments: 8, shares: 15, date: "Apr 10", status: "sent", engRate: "4.6%" },
  { id: 4, channel: "instagram", thumb: "🌅", caption: "There's nothing like a Georgian Bay sunset. This is why we live here...", likes: 203, comments: 31, shares: 22, date: "Apr 8", status: "sent", engRate: "13.9%" },
  { id: 5, channel: "instagram", thumb: "🏠", caption: "Price improvement! 22 Maple Dr, Tiny Township — Now $549,900...", likes: 45, comments: 5, shares: 3, date: "Apr 6", status: "sent", engRate: "2.9%" },
  { id: 6, channel: "instagram", thumb: "🎥", caption: "Behind the scenes of today's listing photoshoot...", likes: 92, comments: 17, shares: 8, date: "Apr 4", status: "sent", engRate: "6.3%" },
  { id: 7, channel: "linkedin", thumb: "📈", caption: "The Georgian Bay real estate market is shifting — here's my take on what Q2 holds for buyers and sellers...", likes: 34, comments: 12, shares: 8, date: "Apr 13", status: "sent", engRate: "8.7%" },
  { id: 8, channel: "linkedin", thumb: "🤝", caption: "Grateful to be recognized in the Top 10 agents for Simcoe County this quarter...", likes: 67, comments: 19, shares: 5, date: "Apr 9", status: "sent", engRate: "14.6%" },
  { id: 9, channel: "google_business", thumb: "⭐", caption: "New 5-star review! 'Jonathan made our first home purchase seamless...'", likes: null, comments: null, shares: null, date: "Apr 15", status: "sent", engRate: null },
];

const scheduledQueue = [
  { id: 101, channel: "instagram", text: "New listing alert! 55 Bayfield St — 3 bed, 2 bath, steps from downtown Midland...", dueAt: "Tomorrow, 10:00 AM", status: "scheduled" },
  { id: 102, channel: "linkedin", text: "5 things I've learned after 200+ real estate transactions in Georgian Bay...", dueAt: "Tomorrow, 12:30 PM", status: "scheduled" },
  { id: 103, channel: "instagram", text: "Open house this weekend! Join us Saturday 1-3 PM at 18 Bayshore Dr...", dueAt: "Fri, 9:00 AM", status: "scheduled" },
  { id: 104, channel: "google_business", text: "Spring market update — Georgian Bay inventory is 23% lower than last year...", dueAt: "Fri, 2:00 PM", status: "scheduled" },
];

const aiStrategyInsights = [
  { id: 1, type: "trending", icon: "🔥", title: "Lifestyle content outperforms listings 3:1", detail: "Your sunset and behind-the-scenes posts get 3x more engagement than property listings. Try leading with lifestyle and weaving in listings naturally.", priority: "high", action: "Create 2 lifestyle posts this week" },
  { id: 2, type: "timing", icon: "⏰", title: "Best posting window: Tues & Thurs, 11 AM–1 PM", detail: "Your audience is most active midday mid-week. Weekend posts get 40% less reach. Schedule key content for the sweet spot.", priority: "medium", action: "Shift weekend posts to Tuesday" },
  { id: 3, type: "content", icon: "💡", title: "Video walkthroughs are your growth engine", detail: "Your listing video from Apr 4 had 6.3% engagement — well above your 4.7% average. Short-form video (Reels) should be 40% of your content mix.", priority: "high", action: "Film 1 walkthrough Reel this week" },
  { id: 4, type: "engagement", icon: "💬", title: "Reply rate is building trust", detail: "You're responding to 92% of comments within 2 hours. This is excellent for algorithm favor. Keep it up — your engagement rate has climbed 0.6% this month.", priority: "low", action: "Maintain response cadence" },
  { id: 5, type: "opportunity", icon: "🎯", title: "LinkedIn is your untapped channel", detail: "Your LinkedIn engagement rate (8.7%) is nearly double Instagram. Consider cross-posting market insights and professional milestones here more often.", priority: "high", action: "Post 3x/week on LinkedIn" },
  { id: 6, type: "idea", icon: "✨", title: "Trending: 'Day in the life of a Realtor' content", detail: "This format is trending heavily on Instagram Reels. Pair it with Georgian Bay scenery for a unique angle that builds personal brand.", priority: "medium", action: "Shoot a 'day in the life' Reel" },
];

function MarketingSection() {
  const [activeTab, setActiveTab] = useState("overview");
  const [gridChannel, setGridChannel] = useState("instagram");
  const [expandedInsight, setExpandedInsight] = useState(null);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "grid", label: "Social Grids" },
    { id: "queue", label: "Queue" },
    { id: "strategy", label: "AI Strategy" },
  ];

  const channelIcon = (svc) => {
    if (svc === "instagram") return "📸";
    if (svc === "linkedin") return "💼";
    if (svc === "google_business") return "📍";
    return "🔗";
  };

  const filteredPosts = recentPosts.filter(p => p.channel === gridChannel);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* HEADER ROW — Buffer branding + channel status */}
      <Card style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🅱️</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Marketing Hub</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Powered by Buffer — 3 channels connected</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
            <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>Synced</span>
          </div>
        </div>

        {/* Channel Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {bufferChannels.map(ch => (
            <div key={ch.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", background: "#fafafa" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>{ch.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</div>
                  <div style={{ fontSize: 10, color: ch.color, fontWeight: 500, textTransform: "capitalize" }}>{ch.service.replace("_", " ")}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                {ch.followers !== null ? (
                  <>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>{ch.followers.toLocaleString()}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981" }}>{ch.growthPct}</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>{ch.avgRating} ⭐</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>{ch.reviews} reviews</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* TAB BAR */}
      <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex: 1, textAlign: "center", padding: "8px 12px", borderRadius: 8, cursor: "pointer",
            background: activeTab === t.id ? "#fff" : "transparent",
            boxShadow: activeTab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            color: activeTab === t.id ? "#111827" : "#6b7280",
            fontWeight: activeTab === t.id ? 700 : 500, fontSize: 12,
            transition: "all 0.15s",
          }}>
            {t.label}
          </div>
        ))}
      </div>

      {/* OVERVIEW TAB — Engagement Metrics */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Metrics Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10 }}>
            {Object.entries(bufferMetrics).map(([key, m]) => (
              <Card key={key} style={{ padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 4, textTransform: "capitalize" }}>
                  {key === "engagementRate" ? "Eng. Rate" : key === "linkClicks" ? "Link Clicks" : key === "profileVisits" ? "Profile Visits" : key.charAt(0).toUpperCase() + key.slice(1)}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{m.value}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, marginTop: 6 }}>
                  <ArrowUpRight size={11} color="#10b981" />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#10b981" }}>{m.change}</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Top Performing Posts */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Star size={14} color="#c8a96e" fill="#c8a96e" />
              Top Performing Posts (Last 30 Days)
            </div>
            {recentPosts.filter(p => parseFloat(p.engRate) > 6).sort((a, b) => parseFloat(b.engRate) - parseFloat(a.engRate)).slice(0, 4).map(post => (
              <div key={post.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{post.thumb}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#111827", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.caption}</div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                    {channelIcon(post.channel)} {post.date} • ❤️ {post.likes} • 💬 {post.comments} • 🔄 {post.shares}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981" }}>{post.engRate}</div>
                  <div style={{ fontSize: 9, color: "#6b7280" }}>eng. rate</div>
                </div>
              </div>
            ))}
          </Card>

          {/* Quick AI Insight */}
          <Card style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Sparkles size={16} color="#c8a96e" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>AI Quick Insight</span>
            </div>
            <div style={{ fontSize: 12, color: "#d1d5db", lineHeight: 1.6 }}>
              Your lifestyle and community content drives 3x more engagement than property listings alone. This week, consider pairing your 55 Bayfield listing with a "neighborhood spotlight" angle — showcase downtown Midland shops and restaurants nearby. Your best-performing post this month was the Georgian Bay sunset (13.9% engagement) — lean into that emotional storytelling.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <div style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(200,169,110,0.15)", color: "#c8a96e", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                💡 Generate Content Ideas
              </div>
              <div style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(255,255,255,0.08)", color: "#9ca3af", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                📊 Full Strategy Report
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* SOCIAL GRIDS TAB */}
      {activeTab === "grid" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Channel Selector */}
          <div style={{ display: "flex", gap: 8 }}>
            {["instagram", "linkedin", "google_business"].map(ch => (
              <div key={ch} onClick={() => setGridChannel(ch)} style={{
                padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: gridChannel === ch ? "#111827" : "#fff",
                color: gridChannel === ch ? "#fff" : "#6b7280",
                border: gridChannel === ch ? "1px solid #111827" : "1px solid #e5e7eb",
              }}>
                {channelIcon(ch)} {ch === "google_business" ? "Google Business" : ch.charAt(0).toUpperCase() + ch.slice(1)}
              </div>
            ))}
          </div>

          {/* Instagram-style Grid */}
          {gridChannel === "instagram" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12 }}>📸 Instagram Grid Preview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {filteredPosts.map(post => (
                  <div key={post.id} style={{
                    aspectRatio: "1", background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)", borderRadius: 6,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", position: "relative", overflow: "hidden",
                  }}>
                    <span style={{ fontSize: 36 }}>{post.thumb}</span>
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                      padding: "20px 8px 8px", color: "#fff",
                    }}>
                      <div style={{ fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.caption.slice(0, 50)}...</div>
                      <div style={{ fontSize: 9, marginTop: 2, opacity: 0.8 }}>❤️ {post.likes} 💬 {post.comments}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, textAlign: "center", fontSize: 11, color: "#6b7280" }}>
                Grid tip: Alternate between property, lifestyle, and market content for visual variety
              </div>
            </Card>
          )}

          {/* LinkedIn Feed View */}
          {gridChannel === "linkedin" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12 }}>💼 LinkedIn Feed</div>
              {recentPosts.filter(p => p.channel === "linkedin").map(post => (
                <div key={post.id} style={{ padding: "14px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#c8a96e,#d4b878)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#111827", fontWeight: 700 }}>JW</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>Jonathan Wallace</div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{post.date}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>{post.caption}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#6b7280" }}>
                    <span>👍 {post.likes}</span>
                    <span>💬 {post.comments} comments</span>
                    <span>🔄 {post.shares} shares</span>
                    <span style={{ marginLeft: "auto", fontWeight: 600, color: "#10b981" }}>{post.engRate} eng.</span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Google Business View */}
          {gridChannel === "google_business" && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12 }}>📍 Google Business Profile</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1, background: "#f9fafb", borderRadius: 10, padding: "16px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#111827" }}>4.9</div>
                  <div style={{ fontSize: 12, color: "#f59e0b" }}>⭐⭐⭐⭐⭐</div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>47 reviews</div>
                </div>
                <div style={{ flex: 1, background: "#f9fafb", borderRadius: 10, padding: "16px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#111827" }}>312</div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>Profile views this month</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, marginTop: 4 }}>
                    <ArrowUpRight size={10} color="#10b981" />
                    <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>+14%</span>
                  </div>
                </div>
                <div style={{ flex: 1, background: "#f9fafb", borderRadius: 10, padding: "16px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#111827" }}>89</div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>Direction requests</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, marginTop: 4 }}>
                    <ArrowUpRight size={10} color="#10b981" />
                    <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>+7%</span>
                  </div>
                </div>
              </div>
              {recentPosts.filter(p => p.channel === "google_business").map(post => (
                <div key={post.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontSize: 12, color: "#374151" }}>{post.caption}</div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>{post.date}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* QUEUE TAB */}
      {activeTab === "queue" && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={14} color="#c8a96e" />
            Scheduled Posts ({scheduledQueue.length} in queue)
          </div>
          {scheduledQueue.map((post, i) => (
            <div key={post.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0", borderBottom: i < scheduledQueue.length - 1 ? "1px solid #f3f4f6" : "none" }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
                background: post.channel === "instagram" ? "#fce7f3" : post.channel === "linkedin" ? "#dbeafe" : "#e0f2fe",
              }}>
                {channelIcon(post.channel)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#111827", lineHeight: 1.5 }}>{post.text}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>📅 {post.dueAt}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: "#c8a96e", background: "#fefce8", padding: "2px 8px", borderRadius: 4 }}>Scheduled</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <div style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 10, color: "#6b7280" }}>Edit</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, border: "1px dashed #d1d5db", textAlign: "center", cursor: "pointer", color: "#6b7280", fontSize: 12 }}>
            + Draft new post via Buffer
          </div>
        </Card>
      )}

      {/* AI STRATEGY TAB */}
      {activeTab === "strategy" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Strategy Header */}
          <Card style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Sparkles size={18} color="#c8a96e" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>AI Marketing Strategist</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>Insights generated from your Buffer analytics and engagement patterns</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#d1d5db", lineHeight: 1.6 }}>
              Based on 30 days of data across 3 channels, here are your personalized recommendations to increase reach and engagement. Your overall engagement rate of 4.7% is above the real estate industry average of 1.2%.
            </div>
          </Card>

          {/* Strategy Cards */}
          {aiStrategyInsights.map(insight => (
            <Card key={insight.id} style={{ cursor: "pointer", border: expandedInsight === insight.id ? "1px solid #c8a96e" : "1px solid #f0f0f0" }}
              onClick={() => setExpandedInsight(expandedInsight === insight.id ? null : insight.id)}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{ fontSize: 22 }}>{insight.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{insight.title}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                      background: insight.priority === "high" ? "#fef2f2" : insight.priority === "medium" ? "#fffbeb" : "#f0fdf4",
                      color: insight.priority === "high" ? "#ef4444" : insight.priority === "medium" ? "#f59e0b" : "#10b981",
                    }}>
                      {insight.priority}
                    </span>
                  </div>
                  {expandedInsight === insight.id && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, marginBottom: 10 }}>{insight.detail}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ padding: "6px 12px", borderRadius: 6, background: "#c8a96e", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          ✅ {insight.action}
                        </div>
                        <div style={{ padding: "6px 12px", borderRadius: 6, background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          📋 Add to Content Plan
                        </div>
                      </div>
                    </div>
                  )}
                  {expandedInsight !== insight.id && (
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>Click to expand — {insight.action}</div>
                  )}
                </div>
              </div>
            </Card>
          ))}

          {/* Content Calendar Preview */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={14} color="#c8a96e" />
              This Week's Content Plan
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
                const isToday = i === 2; // Wednesday
                const planned = [
                  [{ ch: "📸", type: "Listing" }],
                  [{ ch: "💼", type: "Market Insight" }, { ch: "📸", type: "Lifestyle" }],
                  [{ ch: "📸", type: "Reel" }],
                  [{ ch: "💼", type: "Tips" }, { ch: "📍", type: "Update" }],
                  [{ ch: "📸", type: "Open House" }],
                  [],
                  [{ ch: "📸", type: "Community" }],
                ];
                return (
                  <div key={day} style={{
                    textAlign: "center", padding: "8px 4px", borderRadius: 8,
                    background: isToday ? "#fffbeb" : "#fafafa",
                    border: isToday ? "1px solid #c8a96e" : "1px solid #f0f0f0",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? "#c8a96e" : "#6b7280", marginBottom: 6 }}>{day}</div>
                    {planned[i].length > 0 ? planned[i].map((item, j) => (
                      <div key={j} style={{ fontSize: 9, color: "#374151", background: "#fff", borderRadius: 4, padding: "3px 4px", marginBottom: 3, border: "1px solid #e5e7eb" }}>
                        {item.ch} {item.type}
                      </div>
                    )) : (
                      <div style={{ fontSize: 9, color: "#d1d5db", padding: "3px 4px" }}>—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PLACEHOLDER
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// DATA: LISTING SHOWING INTELLIGENCE
// (Parsed from BrokerBay emails via Gmail API)
// ─────────────────────────────────────────────
// Active listings — populated from live BrokerBay/FUB data
const activeListings = [];

// Showing intelligence — populated from live BrokerBay email parsing
const showingIntelligence = [];

// ─────────────────────────────────────────────
// DATA: OUTSTANDING FEEDBACK (you need to give)
// LIVE — parsed from BrokerBay feedback request emails
// ─────────────────────────────────────────────
// Outstanding feedback — populated from live BrokerBay email parsing
const outstandingFeedback = [];

// Follow-up queue — populated from live showing data when connected
const followUpQueue = [];

// ─────────────────────────────────────────────
// P&L SECTION — Split Theory Financial Model (All 4 Tabs)
// (Faithful replica of split-theory.html)
// ─────────────────────────────────────────────


/**
 * PnlSection — Split Theory Financial Modelling Tool (All 4 Tabs)
 * React translation of split-theory.html
 * All CSS embedded with .pnl-container scope to avoid conflicts
 */

function PnlSection() {
  // ── HELPER FUNCTIONS ──
  const fmt = (v) => '$' + Math.round(v).toLocaleString('en-CA');
  const pct = (v) => Math.round(v) + '%';
  const initials = (n) => n.trim().split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('') || '?';
  const getPhase = (y) => (y <= 1 ? 1 : y <= 5 ? 2 : 3);
  const calcRecBonus = (gci, years) => {
    const p = years <= 1 ? 1 : years <= 5 ? 2 : 3;
    return p <= 2 ? Math.min(gci * 0.05, 7500) : gci * 0.025;
  };
  const getWA = (lP, bP, tP, cP) => {
    return lP * tP * (0.60 * 0.30 + 0.25 * 0.60 + 0.15 * 0.25) +
           lP * cP * (0.60 * 0.60 + 0.40 * 0.65) +
           bP * tP * (0.60 * 0.50 + 0.25 * 0.60 + 0.15 * 0.45) +
           bP * cP * (0.60 * 0.70 + 0.40 * 0.75);
  };
  const ab = (amount, capHit) => capHit ? amount : amount * 0.95;

  // ── TAB STATE ──
  const [activeTab, setActiveTab] = useState('pnl');

  // ════════════════════════════════════════════
  // TAB 1: SPLIT CALCULATOR STATE
  // ════════════════════════════════════════════
  const [spState, setSpState] = useState({ price: 700000, rate: 2.5, cap: 0 });
  const spUpdate = (key, value) => setSpState({ ...spState, [key]: parseFloat(value) });

  const spCalc = useMemo(() => {
    const { price, rate, cap } = spState;
    const c = cap === 1;
    const gci = price * (rate / 100);
    const lS = [
      { t: 0.70, a: 0.30, label: 'Team deal' },
      { t: 0.40, a: 0.60, label: 'Cultivated deal' },
      { t: 0.35, a: 0.65, label: 'Repeat client (cultivated)' },
      { t: 0.40, a: 0.60, label: 'Repeat client (team lead)' },
      { t: 0.75, a: 0.25, label: 'Repeat client (team lead, no nurture proof)' },
    ];
    const bS = [
      { t: 0.50, a: 0.50, label: 'Team deal' },
      { t: 0.30, a: 0.70, label: 'Cultivated deal' },
      { t: 0.25, a: 0.75, label: 'Repeat client (cultivated)' },
      { t: 0.40, a: 0.60, label: 'Repeat client (team lead)' },
      { t: 0.55, a: 0.45, label: 'Repeat client (team lead, no nurture proof)' },
    ];
    return { gci, c, lS, bS };
  }, [spState]);

  // ════════════════════════════════════════════
  // TAB 2: BUSINESS PROFILE STATE
  // ════════════════════════════════════════════
  const [bpState, setBpState] = useState({ deals: 20, rate: 2.5, price: 575000, list: 60, team: 40, cap: 0 });
  const bpUpdate = (key, value) => setBpState({ ...bpState, [key]: parseFloat(value) });

  const bpCalc = useMemo(() => {
    const { deals, rate, price, list, team, cap } = bpState;
    const c = cap === 1;
    const gci = price * (rate / 100);
    const totalGci = gci * deals;
    const lP = list / 100, bP = 1 - lP, tP = team / 100, cP = 1 - tP;
    const wA = getWA(lP, bP, tP, cP);
    const baseDeals = Math.min(deals, 50);
    const overDeals = Math.max(deals - 50, 0);
    const baseNet = gci * baseDeals * wA * (c ? 1 : 0.95);
    const overNet = gci * overDeals * 0.85 * (c ? 1 : 0.95);
    const agentNet = baseNet + overNet;
    const blendedPct = deals > 0 ? (baseDeals * wA + overDeals * 0.85) / deals : wA;

    const sets = [
      { side: 'list', a: 0.30, w: lP * tP * 0.60, label: 'Team deal', desc: 'Lead sourced by the team', pctLabel: 'Agent 30%' },
      { side: 'list', a: 0.60, w: lP * cP * 0.60, label: 'Cultivated deal', desc: 'You brought the client', pctLabel: 'Agent 60%' },
      { side: 'list', a: 0.65, w: lP * cP * 0.40, label: 'Repeat client (cultivated)', desc: 'Nurtured back — your client', pctLabel: 'Agent 65%' },
      { side: 'list', a: 0.60, w: lP * tP * 0.25, label: 'Repeat client (team lead)', desc: 'Team sourced, came back', pctLabel: 'Agent 60%' },
      { side: 'list', a: 0.25, w: lP * tP * 0.15, label: 'Repeat (no nurture proof)', desc: 'No documented nurture', pctLabel: 'Agent 25%' },
      { side: 'buyer', a: 0.50, w: bP * tP * 0.60, label: 'Team deal', desc: 'Lead sourced by the team', pctLabel: 'Agent 50%' },
      { side: 'buyer', a: 0.70, w: bP * cP * 0.60, label: 'Cultivated deal', desc: 'You brought the client', pctLabel: 'Agent 70%' },
      { side: 'buyer', a: 0.75, w: bP * cP * 0.40, label: 'Repeat client (cultivated)', desc: 'Nurtured back — your client', pctLabel: 'Agent 75%' },
      { side: 'buyer', a: 0.60, w: bP * tP * 0.25, label: 'Repeat client (team lead)', desc: 'Team sourced, came back', pctLabel: 'Agent 60%' },
      { side: 'buyer', a: 0.45, w: bP * tP * 0.15, label: 'Repeat (no nurture proof)', desc: 'No documented nurture', pctLabel: 'Agent 45%' },
    ];

    const listLabel = list >= 60 ? 'listing-heavy' : list <= 40 ? 'buyer-heavy' : 'balanced';
    const srcLabel = team >= 60 ? 'rely heavily on team leads' : team <= 30 ? 'run a largely self-cultivated book' : 'split leads between the team and your own network';
    const strength = wA >= 0.58 ? 'strong' : wA >= 0.45 ? 'solid' : 'growing';
    const overMsg = overDeals > 0 ? ` Your <b>${overDeals} deals above 50</b> move to the 85/15 high-volume split, adding <b>${fmt(overNet)}</b> to your take-home.` : '';
    const storyTitle = `A ${listLabel} agent who ${srcLabel}`;
    const storyText = `Based on your profile, your weighted agent share is <b>${pct(wA * 100)}</b> of GCI. Across <b>${Math.round(deals)} deals</b> at an average of <b>${fmt(price)}</b>, your estimated annual take-home is <b>${fmt(agentNet)}</b> — a <b>${strength}</b> foundation.${overMsg} The more you grow your cultivated book, the higher your share climbs.`;

    return { gci, totalGci, wA, agentNet, blendedPct, overDeals, overNet, sets, c, storyTitle, storyText };
  }, [bpState]);

  // ════════════════════════════════════════════
  // TAB 3: RECRUITING STATE
  // ════════════════════════════════════════════
  const [recAgents, setRecAgents] = useState([
    { id: 1, name: 'Agent 1', gci: 200000, year: 1 },
    { id: 2, name: 'Agent 2', gci: 150000, year: 3 },
  ]);
  const [recNextId, setRecNextId] = useState(3);

  const addRecAgent = () => {
    setRecAgents([...recAgents, { id: recNextId, name: 'Agent ' + recNextId, gci: 150000, year: 1 }]);
    setRecNextId(recNextId + 1);
  };
  const removeRecAgent = (id) => setRecAgents(recAgents.filter(a => a.id !== id));
  const updateRecAgent = (id, key, value) => {
    setRecAgents(recAgents.map(a => a.id === id ? { ...a, [key]: key === 'name' ? value : parseFloat(value) } : a));
  };
  const updateRecAgentName = (id, name) => {
    setRecAgents(recAgents.map(a => a.id === id ? { ...a, name } : a));
  };

  const recCalc = useMemo(() => {
    let total = 0;
    const agentData = recAgents.map(a => {
      const payout = calcRecBonus(a.gci, a.year);
      total += payout;
      const p = getPhase(a.year);
      const pctStr = p <= 2 ? '5%' : '2.5%';
      const capped = p <= 2 && (a.gci * 0.05 >= 7500);
      const phaseLabel = p === 1 ? 'Year 1 — mentorship' : p === 2 ? 'Years 2–5 — passive' : 'Year 5+ — no cap';
      const phaseCls = p === 1 ? 'p1' : p === 2 ? 'p2' : 'p3';
      return { ...a, payout, pctStr, capped, phaseLabel, phaseCls, mentor: p === 1 };
    });
    const count = recAgents.length;
    const avg = count > 0 ? total / count : 0;

    // 5-year projection
    const proj = [1, 2, 3, 4, 5].map(offset => {
      const amt = recAgents.reduce((sum, a) => sum + calcRecBonus(a.gci, a.year + offset - 1), 0);
      const avgYr = recAgents.length > 0 ? Math.round(recAgents.reduce((s, a) => s + (a.year + offset - 1), 0) / recAgents.length) : 2;
      const p = getPhase(avgYr);
      const barColor = p === 1 ? '#534AB7' : p === 2 ? '#1D9E75' : '#BA7517';
      return { year: offset, amt, barColor };
    });
    const projMax = Math.max(...proj.map(p => p.amt), 1);

    return { total, count, avg, agentData, proj, projMax };
  }, [recAgents]);


  // ════════════════════════════════════════════
  // TAB 4: TEAM P&L STATE (from working v2)
  // ════════════════════════════════════════════
  const [pnlAgents, setPnlAgents] = useState([
    { id: 1, name: 'Jonathan Wallace', deals: 40, avgPrice: 700000, listPct: 60, teamPct: 10, recruitedBy: 0, yearsOnTeam: 1, role: 'owner', ownerPct: 100, commRate: 2.5 },
    { id: 2, name: 'Sabrina Staunton', deals: 50, avgPrice: 900000, listPct: 70, teamPct: 10, recruitedBy: 0, yearsOnTeam: 1, role: 'agent', ownerPct: 0, commRate: 2.5 },
    { id: 3, name: 'Ryan Lesperance', deals: 35, avgPrice: 700000, listPct: 60, teamPct: 30, recruitedBy: 0, yearsOnTeam: 1, role: 'agent', ownerPct: 0, commRate: 2.5 },
    { id: 4, name: 'Wyatt Negrini', deals: 30, avgPrice: 575000, listPct: 50, teamPct: 50, recruitedBy: 0, yearsOnTeam: 1, role: 'agent', ownerPct: 0, commRate: 2.5 },
    { id: 5, name: 'Michael Paccanaro', deals: 25, avgPrice: 600000, listPct: 40, teamPct: 50, recruitedBy: 0, yearsOnTeam: 1, role: 'agent', ownerPct: 0, commRate: 2.5 },
    { id: 6, name: 'Jawni Thurston', deals: 20, avgPrice: 550000, listPct: 30, teamPct: 60, recruitedBy: 2, yearsOnTeam: 1, role: 'agent', ownerPct: 0, commRate: 2.5 },
  ]);

  const [nextPnlId, setNextPnlId] = useState(7);

  // ── STATE: Expenses & toggles ──
  const [pnlState, setPnlState] = useState({
    marketing: 2000,
    listingCost: 1250,
    expireRate: 30,
    buyerCost: 250,
    webCost: 500,
    eventsCost: 5000,
    billboardCost: 1000,
    adminSalary: 70000,
    adminBonusRate: 200,
    rentCost: 2500,
    crmCost: 75,
    swCost: 75,
    onboardCost: 500,
    officeCost: 500,
    reinvestPct: 20,
    ownerTeamCap: 250000,
  });

  const [expToggles, setExpToggles] = useState({
    admin: true,
    bonus: true,
    rent: true,
    mkt: true,
    crm: true,
    sw: true,
    list: true,
    buyer: true,
    onboard: true,
    brok: true,
    recbonus: true,
    web: true,
    events: true,
    billboard: true,
    office: true,
  });

  // ── STATE: Custom expenses ──
  const [customExps, setCustomExps] = useState([]);
  const [customExpId, setCustomExpId] = useState(1);

  // ── STATE: Capital expenses ──
  const [capExps, setCapExps] = useState([]);
  const [capExId, setCapExId] = useState(1);

  // ── HANDLERS: Agents ──
  const addPnlAgent = () => {
    const newAgent = {
      id: nextPnlId,
      name: 'Added Agent',
      deals: 20,
      avgPrice: 575000,
      listPct: 60,
      teamPct: 40,
      recruitedBy: 0,
      yearsOnTeam: 1,
      role: 'agent',
      ownerPct: 0,
      commRate: 2.5,
    };
    setPnlAgents([...pnlAgents, newAgent]);
    setNextPnlId(nextPnlId + 1);
  };

  const removePnlAgent = (id) => {
    const updated = pnlAgents.filter(a => a.id !== id);
    // If removed agent was recruiter, orphan their recruits
    updated.forEach(a => {
      if (a.recruitedBy === id) a.recruitedBy = 0;
    });
    setPnlAgents(updated);
  };

  const updatePnlAgent = (id, key, value) => {
    const updated = pnlAgents.map(a => {
      if (a.id !== id) return a;
      const v = key === 'name' ? value : parseFloat(value);
      if (key === 'role') {
        const newAgent = { ...a, role: v };
        if (v === 'agent') {
          newAgent.ownerPct = 0;
          // Rebalance other owners
          const owners = updated.filter(x => x.role === 'owner' || x.role === 'coowner');
          if (owners.length === 1) owners[0].ownerPct = 100;
          else if (owners.length > 1) autoAssignOwnership(updated);
        } else {
          autoAssignOwnership(updated, id);
        }
        return newAgent;
      } else if (key === 'ownerPct') {
        const newAgent = { ...a, ownerPct: v };
        rebalanceOwnerPcts(updated, id, v);
        return newAgent;
      } else {
        return { ...a, [key]: v };
      }
    });
    setPnlAgents(updated);
  };

  const updatePnlAgentName = (id, name) => {
    setPnlAgents(pnlAgents.map(a => (a.id === id ? { ...a, name } : a)));
  };

  const rebalanceOwnerPcts = (agents, changedId, newPct) => {
    const owners = agents.filter(a => a.role === 'owner' || a.role === 'coowner');
    if (owners.length < 2) return;
    const changed = owners.find(o => o.id === changedId);
    if (!changed) return;
    changed.ownerPct = Math.min(Math.max(newPct, 5), 95);
    const others = owners.filter(o => o.id !== changedId);
    const remaining = 100 - changed.ownerPct;
    const othersTotal = others.reduce((s, o) => s + o.ownerPct, 0);
    if (othersTotal > 0) {
      let distributed = 0;
      others.forEach((o, i) => {
        if (i === others.length - 1) {
          o.ownerPct = Math.round((remaining - distributed) * 10) / 10;
        } else {
          const share = Math.round(remaining * (o.ownerPct / othersTotal) * 10) / 10;
          o.ownerPct = Math.max(share, 5);
          distributed += o.ownerPct;
        }
      });
      others.forEach(o => {
        if (o.ownerPct < 5) o.ownerPct = 5;
      });
    } else {
      const each = Math.round(remaining / others.length * 10) / 10;
      others.forEach(o => (o.ownerPct = each));
      others[others.length - 1].ownerPct = Math.round((remaining - each * (others.length - 1)) * 10) / 10;
    }
    const total = owners.reduce((s, o) => s + o.ownerPct, 0);
    if (Math.abs(total - 100) > 0.1) {
      const last = others[others.length - 1];
      last.ownerPct = Math.round((last.ownerPct + (100 - total)) * 10) / 10;
    }
  };

  const autoAssignOwnership = (agents, newOwnerId) => {
    const owners = agents.filter(a => a.role === 'owner' || a.role === 'coowner');
    const even = Math.round(100 / owners.length * 10) / 10;
    owners.forEach(o => (o.ownerPct = even));
    owners[owners.length - 1].ownerPct = Math.round((100 - even * (owners.length - 1)) * 10) / 10;
  };

  // ── HANDLERS: Expenses ──
  const togExp = (key, on) => {
    setExpToggles({ ...expToggles, [key]: on });
  };

  const addCustomExp = () => {
    setCustomExps([...customExps, { id: customExpId, name: 'New expense', amount: 500, freq: 'monthly', enabled: true }]);
    setCustomExpId(customExpId + 1);
  };

  const removeCustomExp = (id) => {
    setCustomExps(customExps.filter(e => e.id !== id));
  };

  const updateCustomExp = (id, key, value) => {
    setCustomExps(customExps.map(e => {
      if (e.id !== id) return e;
      if (key === 'amount') return { ...e, amount: parseFloat(value) || 0 };
      return { ...e, [key]: value };
    }));
  };

  const toggleCustomFreq = (id) => {
    setCustomExps(customExps.map(e => {
      if (e.id !== id) return e;
      return { ...e, freq: e.freq === 'monthly' ? 'annual' : 'monthly' };
    }));
  };

  const togCustomExp = (id, on) => {
    setCustomExps(customExps.map(e => (e.id === id ? { ...e, enabled: on } : e)));
  };

  const getCustomExpTotal = () => {
    return customExps.reduce((sum, e) => {
      if (e.enabled === false) return sum;
      return sum + (e.freq === 'monthly' ? e.amount * 12 : e.amount);
    }, 0);
  };

  // ── HANDLERS: Capital Expenses ──
  const addCapEx = () => {
    setCapExps([...capExps, { id: capExId, name: 'New project', amount: 50000, months: 12 }]);
    setCapExId(capExId + 1);
  };

  const removeCapEx = (id) => {
    setCapExps(capExps.filter(e => e.id !== id));
  };

  const updateCapEx = (id, key, value) => {
    setCapExps(capExps.map(e => {
      if (e.id !== id) return e;
      if (key === 'amount' || key === 'months') return { ...e, [key]: parseFloat(value) || 0 };
      return { ...e, [key]: value };
    }));
  };

  const getCapExTotal = () => capExps.reduce((s, e) => s + e.amount, 0);
  const getCapExMonthly = () => capExps.reduce((s, e) => s + (e.months > 0 ? e.amount / e.months : 0), 0);

  // ── HANDLERS: Global state ──
  const pnlU = (key, value) => {
    setPnlState({ ...pnlState, [key]: parseFloat(value) });
  };

  // ── COMPUTE: P&L calculation ──
  const pnlData = useMemo(() => {
    const s = pnlState;
    const t = expToggles;

    const numAgents = pnlAgents.filter(a => a.role === 'agent').length;
    const numOwners = pnlAgents.filter(a => a.role === 'owner' || a.role === 'coowner').length;
    const numAll = pnlAgents.length;
    const expMult = 1 / (1 - s.expireRate / 100);

    let totalTeamRev = 0, totalDeals = 0, totalListings = 0, totalBuyers = 0, totalRecBonus = 0;
    const memberData = [];

    pnlAgents.forEach(a => {
      const isOwner = a.role === 'owner' || a.role === 'coowner';
      const lP = a.listPct / 100, bP = 1 - lP, tP = a.teamPct / 100, cP = 1 - tP;
      const wA = getWA(lP, bP, tP, cP);
      const gci = a.deals * a.avgPrice * (a.commRate / 100);
      const rawTeamShare = gci * (1 - wA);
      const teamShare = isOwner ? Math.min(rawTeamShare, s.ownerTeamCap) : rawTeamShare;
      const capExcess = isOwner ? Math.max(rawTeamShare - s.ownerTeamCap, 0) : 0;
      const agentShare = gci * wA + capExcess;
      totalTeamRev += teamShare;
      totalDeals += a.deals;
      totalListings += a.deals * lP;
      totalBuyers += a.deals * bP;
      memberData.push({ id: a.id, name: a.name, role: a.role, gci, agentShare, teamShare, wA, ownerPct: a.ownerPct });

      const recruiter = pnlAgents.find(r => r.id === a.recruitedBy);
      if (recruiter) totalRecBonus += calcRecBonus(gci, a.yearsOnTeam);
    });

    const totalPeople = numAll;
    const adminAnnual = s.adminSalary * 1.13;
    const rentAnnual = s.rentCost * 12;
    const mktAnnual = s.marketing * 12;
    const crmAnnual = s.crmCost * totalPeople * 12;
    const swAnnual = s.swCost * totalPeople * 12;
    const onboard = s.onboardCost * numAll;
    const officeAnnual = s.officeCost * 12;
    const allListingsTaken = totalListings * expMult;
    const expiredCount = allListingsTaken - totalListings;
    const listCostAnnual = allListingsTaken * s.listingCost;
    const expiredCost = expiredCount * s.listingCost;
    const buyerCostAnnual = totalBuyers * s.buyerCost;
    const adminBonus = totalDeals > 80 ? (totalDeals - 80) * s.adminBonusRate : 0;
    const allOwnersList = memberData.filter(m => m.role === 'owner' || m.role === 'coowner');
    const ownerBrok = allOwnersList.reduce((sum, o) => sum + Math.min(o.gci * 0.05, 5000), 0);
    const webAnnual = s.webCost * 12;
    const eventsAnnual = s.eventsCost || 0;
    const billboardAnnual = s.billboardCost * 12;
    const customTotal = getCustomExpTotal();

    const totalExp =
      (t.admin ? adminAnnual : 0) +
      (t.rent ? rentAnnual : 0) +
      (t.mkt ? mktAnnual : 0) +
      (t.crm ? crmAnnual : 0) +
      (t.sw ? swAnnual : 0) +
      (t.onboard ? onboard : 0) +
      (t.list ? listCostAnnual : 0) +
      (t.buyer ? buyerCostAnnual : 0) +
      (t.bonus ? adminBonus : 0) +
      (t.brok ? ownerBrok : 0) +
      (t.recbonus ? totalRecBonus : 0) +
      (t.web ? webAnnual : 0) +
      (t.events ? eventsAnnual : 0) +
      (t.billboard ? billboardAnnual : 0) +
      (t.office ? officeAnnual : 0) +
      customTotal;

    const netProfit = totalTeamRev - totalExp;
    const costPerDeal = totalDeals > 0 ? totalExp / totalDeals : 0;

    const totalOwnershipPct = allOwnersList.reduce((sum, o) => sum + o.ownerPct, 0) || 100;
    const reinvestPct = s.reinvestPct / 100;
    const reinvestAmt = Math.max(netProfit, 0) * reinvestPct;
    const distributableProfit = Math.max(netProfit, 0) * (1 - reinvestPct);
    const capExTotal = getCapExTotal();
    const capExMonthly = getCapExMonthly();
    const capExCovered = reinvestAmt >= capExTotal;

    const ownerDist = allOwnersList.map(o => {
      const normPct = o.ownerPct / totalOwnershipPct;
      const profitShare = distributableProfit * normPct;
      const totalTakeHome = o.agentShare + profitShare;
      return { id: o.id, name: o.name, role: o.role, gci: o.gci, agentShare: o.agentShare, teamShare: o.teamShare, wA: o.wA, ownerPct: o.ownerPct, normalizedPct: Math.round(normPct * 100), profitShare, totalTakeHome };
    });

    const agentOnlyRev = memberData.filter(m => m.role === 'agent').reduce((s, m) => s + m.teamShare, 0);
    const agentOnlyDeals = pnlAgents.filter(a => a.role === 'agent').reduce((s, a) => s + a.deals, 0);
    const ownerRev = totalTeamRev - agentOnlyRev;

    const beDisplay = numAgents > 0 && agentOnlyDeals > 0
      ? '~' + Math.ceil((totalExp - ownerRev) / Math.max(agentOnlyRev / agentOnlyDeals, 1) / numAgents * 10) / 10
      : 'N/A';

    const annualCapExSpend = getCapExMonthly() * 12;
    let fundBal = 0;
    const fundBalances = [];
    for (let yr = 1; yr <= 5; yr++) {
      const yrIn = reinvestAmt;
      const yrOut = Math.min(annualCapExSpend, capExTotal > 0 ? capExTotal : 0);
      fundBal += yrIn - yrOut;
      fundBalances.push({ year: yr, in: yrIn, out: yrOut, balance: fundBal });
    }

    const margin = totalTeamRev > 0 ? Math.round(netProfit / totalTeamRev * 100) : 0;
    const health = netProfit < 0 ? 'in the red' : margin < 15 ? 'tight — margins under 15%' : margin < 30 ? 'healthy' : 'strong';
    const listDrag = expiredCost > 5000 ? ` Your <b>${Math.round(s.expireRate)}% expire rate</b> costs <b>${fmt(expiredCost)}</b>/year in dead listing expenses.` : '';
    const recNote = totalRecBonus > 0 ? ` Recruiting bonuses cost the team <b>${fmt(totalRecBonus)}</b>/year.` : '';
    const ownerCount = allOwnersList.length;

    return {
      numAgents,
      numOwners,
      numAll,
      totalTeamRev,
      totalDeals,
      totalListings,
      totalBuyers,
      totalRecBonus,
      totalExp,
      netProfit,
      costPerDeal,
      adminAnnual,
      rentAnnual,
      mktAnnual,
      crmAnnual,
      swAnnual,
      onboard,
      officeAnnual,
      listCostAnnual,
      expiredCount,
      expiredCost,
      buyerCostAnnual,
      adminBonus,
      ownerBrok,
      webAnnual,
      eventsAnnual,
      billboardAnnual,
      allListingsTaken,
      allOwnersList,
      ownerDist,
      agentOnlyRev,
      agentOnlyDeals,
      ownerRev,
      beDisplay,
      reinvestAmt,
      distributableProfit,
      capExTotal,
      capExMonthly,
      capExCovered,
      fundBalances,
      margin,
      health,
      listDrag,
      recNote,
      ownerCount,
    };
  }, [pnlAgents, pnlState, expToggles, customExps, capExps]);

  // ── EXPORT FUNCTIONS ──
  const exportPnlCSV = () => {
    const s = pnlState, t = expToggles;
    const fmt_csv = v => '$' + (Math.round(v * 100) / 100);
    const esc = v => {
      const str = String(v);
      return (str.includes(',') || str.includes('"')) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const rows = [];
    const addRow = (...cols) => rows.push(cols.map(esc).join(','));
    const blank = () => rows.push('');

    addRow('TEAM P&L EXPORT', '', 'Generated', new Date().toLocaleDateString('en-CA'));
    blank();

    // ROSTER
    addRow('AGENT ROSTER');
    addRow('Name', 'Role', 'Deals', 'Avg Price', 'Comm Rate', 'Listing %', 'Team %', 'GCI', 'Agent Share', 'Team Share');
    pnlAgents.forEach(a => {
      const lP = a.listPct / 100, bP = 1 - lP, tP = a.teamPct / 100, cP = 1 - tP;
      const wA = getWA(lP, bP, tP, cP);
      const gci = a.deals * a.avgPrice * (a.commRate / 100);
      const agentShare = gci * wA;
      const teamShare = gci * (1 - wA);
      addRow(a.name, a.role, a.deals, '$' + Math.round(a.avgPrice), a.commRate + '%', a.listPct + '%', a.teamPct + '%', fmt_csv(gci), fmt_csv(agentShare), fmt_csv(teamShare));
    });
    blank();

    // REVENUE
    addRow('REVENUE');
    addRow('Agent deals — team share', fmt_csv(pnlData.agentOnlyRev));
    addRow('Owner deals — team share', fmt_csv(pnlData.ownerRev));
    addRow('Total Revenue', fmt_csv(pnlData.totalTeamRev));
    blank();

    // EXPENSES
    addRow('EXPENSES', 'Annual Amount', 'Enabled');
    const expLines = [
      ['Admin salary + 13% burden', pnlData.adminAnnual, t.admin],
      ['Admin bonus', pnlData.adminBonus, t.bonus],
      ['Office rent', pnlData.rentAnnual, t.rent],
      ['Marketing & lead gen', pnlData.mktAnnual, t.mkt],
      ['CRM — Follow Up Boss', pnlData.crmAnnual, t.crm],
      ['Software & tools', pnlData.swAnnual, t.sw],
      ['Listing costs (incl. expired)', pnlData.listCostAnnual, t.list],
      ['Buyer deal costs', pnlData.buyerCostAnnual, t.buyer],
      ['Agent onboarding', pnlData.onboard, t.onboard],
      ['Recruiting bonuses', pnlData.totalRecBonus, t.recbonus],
      ['Owner brokerage', pnlData.ownerBrok, t.brok],
      ['Website & hosting', pnlData.webAnnual, t.web],
      ['Client events', pnlData.eventsAnnual, t.events],
      ['Billboards', pnlData.billboardAnnual, t.billboard],
      ['Office peripherals & supplies', pnlData.officeAnnual, t.office],
    ];
    expLines.forEach(e => addRow(e[0], fmt_csv(e[1]), e[2] ? 'Yes' : 'No'));
    customExps.forEach(e => {
      const amt = e.freq === 'monthly' ? e.amount * 12 : e.amount;
      addRow(e.name + ' (custom)', fmt_csv(amt), e.enabled !== false ? 'Yes' : 'No');
    });
    blank();

    addRow('TOTAL EXPENSES', fmt_csv(pnlData.totalExp), '');
    addRow('NET PROFIT', fmt_csv(pnlData.netProfit), '');
    blank();

    // PROFIT DISTRIBUTION
    addRow('PROFIT DISTRIBUTION');
    addRow('Net profit', fmt_csv(pnlData.netProfit));
    addRow('Reinvest %', s.reinvestPct + '%');
    addRow('Carried over', fmt_csv(pnlData.reinvestAmt));
    addRow('Distributable to owners', fmt_csv(pnlData.distributableProfit));
    blank();

    // OWNERS
    addRow('OWNER DISTRIBUTION');
    addRow('Name', 'GCI', 'Agent Share', 'Team Share', 'Profit Share', 'Total Take-Home');
    pnlData.ownerDist.forEach(o => {
      addRow(o.name, fmt_csv(o.gci), fmt_csv(o.agentShare), fmt_csv(o.teamShare), fmt_csv(o.profitShare), fmt_csv(o.totalTakeHome));
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team-pnl-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPnl = () => {
    window.print();
  };

  // ── RENDER ──
  return (
    <div className="pnl-container">
      <style>{`
        .pnl-container, .pnl-container * { box-sizing: border-box; }
        .pnl-container {
          --color-bg: #ffffff;
          --color-bg-secondary: #f5f5f3;
          --color-bg-tertiary: #eeede9;
          --color-text: #1a1a18;
          --color-text-secondary: #6b6b68;
          --color-text-tertiary: #9a9a96;
          --color-border: rgba(0,0,0,0.12);
          --color-border-secondary: rgba(0,0,0,0.2);
          --color-purple: #534AB7;
          --color-purple-light: #EEEDFE;
          --color-purple-dark: #3C3489;
          --color-teal: #0F6E56;
          --color-teal-light: #E1F5EE;
          --color-teal-dark: #085041;
          --color-amber: #854F0B;
          --color-amber-light: #FAEEDA;
          --color-amber-dark: #633806;
          --color-red: #A32D2D;
          --color-red-light: #FCEBEB;
          --color-green: #0F6E56;
          --color-green-light: #EAF3DE;
          --color-green-dark: #3B6D11;
          --radius-md: 8px;
          --radius-lg: 12px;
          --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .pnl-container { font-family: var(--font); color: var(--color-text); }
        /* Tab bar */
        .pnl-container .tab-bar { display: flex; gap: 4px; margin-bottom: 1.5rem; border-bottom: 0.5px solid var(--color-border); padding-bottom: 0; background: transparent; }
        .pnl-container .tab { font-size: 13px; font-weight: 500; padding: 8px 18px 12px; cursor: pointer; color: var(--color-text-secondary); border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; border-top: none; border-left: none; border-right: none; transition: color 0.15s; }
        .pnl-container .tab:hover { color: var(--color-text); }
        .pnl-container .tab.active { color: var(--color-text); border-bottom: 2px solid var(--color-purple); }
        /* Shared */
        .pnl-container .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-secondary); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .rec-hero { background: var(--color-bg-secondary); border-radius: var(--radius-lg); padding: 1.5rem; margin-bottom: 1.25rem; }
        .pnl-container .rec-hero-title { font-size: 17px; font-weight: 600; margin-bottom: 5px; }
        .pnl-container .rec-hero-sub { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
        .pnl-container .bp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1.25rem; }
        .pnl-container .bp-ctrl { background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1rem; }
        .pnl-container .bp-ctrl-title { font-size: 12px; font-weight: 600; margin-bottom: 12px; }
        .pnl-container .sl-row { margin-bottom: 10px; }
        .pnl-container .sl-row:last-child { margin-bottom: 0; }
        .pnl-container .sl-lrow { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .pnl-container .sl-label { font-size: 12px; color: var(--color-text-secondary); }
        .pnl-container .sl-val { font-size: 12px; font-weight: 600; }
        .pnl-container .sl-row input[type=range] { width: 100%; accent-color: var(--color-purple); }
        .pnl-container .bp-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 1.25rem; }
        .pnl-container .metric { background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 0.875rem 1rem; }
        .pnl-container .metric-label { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; line-height: 1.4; }
        .pnl-container .metric-val { font-size: 18px; font-weight: 600; }
        .pnl-container .metric-val.green { color: var(--color-green); }
        .pnl-container .metric-val.red { color: var(--color-red); }
        .pnl-container .bp-breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 1.25rem; }
        .pnl-container .bpbc { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; }
        .pnl-container .bpbc-title { font-size: 12px; font-weight: 600; margin-bottom: 10px; padding-bottom: 7px; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .bpbc-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 0.5px solid var(--color-border); gap: 8px; }
        .pnl-container .bpbc-row:last-child { border-bottom: none; }
        .pnl-container .bpbc-row.disabled .bpbc-name, .pnl-container .bpbc-row.disabled .bpbc-desc, .pnl-container .bpbc-row.disabled .bpbc-amt, .pnl-container .bpbc-row.disabled .bpbc-pct { opacity: 0.35; text-decoration: line-through; }
        .pnl-container .bpbc-name { font-size: 12px; font-weight: 600; }
        .pnl-container .bpbc-desc { font-size: 11px; color: var(--color-text-secondary); margin-top: 1px; }
        .pnl-container .bpbc-amt { font-size: 13px; font-weight: 600; color: var(--color-green); text-align: right; }
        .pnl-container .bpbc-pct { font-size: 11px; color: var(--color-text-secondary); }
        .pnl-container .bpbc-w { font-size: 11px; color: var(--color-text-tertiary); margin-top: 1px; }
        .pnl-container .agents-list { margin-bottom: 1rem; }
        .pnl-container .agent-row { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 8px; }
        .pnl-container .agent-row:last-child { margin-bottom: 0; }
        .pnl-container .agent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .pnl-container .agent-av { width: 32px; height: 32px; border-radius: 50%; background: var(--color-purple-light); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--color-purple); flex-shrink: 0; }
        .pnl-container .agent-name-input { font-size: 13px; font-weight: 600; border: none; background: transparent; color: var(--color-text); outline: none; }
        .pnl-container .remove-btn { font-size: 11px; color: var(--color-red); background: none; border: none; cursor: pointer; padding: 3px 8px; border-radius: 4px; }
        .pnl-container .remove-btn:hover { background: var(--color-red-light); }
        .pnl-container .agent-ctrls { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 10px; }
        .pnl-container .ac-label { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; }
        .pnl-container .ac-val { font-size: 12px; font-weight: 600; margin-top: 3px; }
        .pnl-container .agent-ctrls input[type=range] { width: 100%; accent-color: var(--color-purple); }
        .pnl-container .agent-result { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 0.5px solid var(--color-border); }
        .pnl-container .ar-breakdown { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; }
        .pnl-container .ar-payout { font-size: 16px; font-weight: 700; color: var(--color-green); }
        .pnl-container .ar-mentor { font-size: 11px; color: var(--color-purple); margin-top: 2px; text-align: right; }
        .pnl-container .add-btn { width: 100%; padding: 10px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: var(--radius-md); border: 0.5px dashed var(--color-border-secondary); background: transparent; color: var(--color-text-secondary); margin-bottom: 1.25rem; transition: background 0.15s; }
        .pnl-container .add-btn:hover { background: var(--color-bg-secondary); }
        .pnl-container .card { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 0.875rem 1rem; margin-bottom: 8px; }
        .pnl-container .card:last-child { margin-bottom: 0; }
        .pnl-container .card-title { font-size: 12px; font-weight: 600; margin-bottom: 10px; color: var(--color-text); }
        .pnl-container .story-box { background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
        .pnl-container .story-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
        .pnl-container .story-text { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
        .pnl-container .story-text b { color: var(--color-text); font-weight: 600; }
        .pnl-container .cut-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
        .pnl-container .cut-table th { text-align: left; font-weight: 600; font-size: 11px; color: var(--color-text-secondary); padding: 5px 8px; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .cut-table td { padding: 7px 8px; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .cut-table tr:last-child td { border-bottom: none; }
        .pnl-container .cut-table .ok { color: var(--color-green); font-weight: 600; }
        .pnl-container .cut-table .warn { color: var(--color-amber); font-weight: 600; }
        .pnl-container .cut-table .bad { color: var(--color-red); font-weight: 600; }
        .pnl-container .footnote { font-size: 11px; color: var(--color-text-tertiary); padding-top: 0.75rem; border-top: 0.5px solid var(--color-border); line-height: 1.7; margin-top: 1rem; }
        .pnl-container .exp-toggle { position: relative; width: 32px; height: 18px; flex-shrink: 0; }
        .pnl-container .exp-toggle input { opacity: 0; width: 0; height: 0; }
        .pnl-container .exp-toggle .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 18px; transition: 0.2s; }
        .pnl-container .exp-toggle .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background: white; border-radius: 50%; transition: 0.2s; }
        .pnl-container .exp-toggle input:checked + .slider { background: var(--color-purple); }
        .pnl-container .exp-toggle input:checked + .slider:before { transform: translateX(14px); }
        .pnl-container .custom-exp-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .custom-exp-row:last-child { border-bottom: none; }
        .pnl-container .custom-exp-input { font-size: 12px; font-weight: 600; border: none; border-bottom: 1px dashed var(--color-border-secondary); background: transparent; color: var(--color-text); outline: none; padding: 2px 0; }
        .pnl-container .custom-exp-amt { font-size: 12px; font-weight: 600; border: none; border-bottom: 1px dashed var(--color-border-secondary); background: transparent; color: var(--color-red); outline: none; padding: 2px 0; text-align: right; }
        .pnl-container .custom-exp-freq { font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 0.5px solid var(--color-border); background: var(--color-bg-secondary); cursor: pointer; color: var(--color-text-secondary); }
        .pnl-container .custom-exp-remove { font-size: 11px; color: var(--color-red); background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
        .pnl-container .custom-exp-remove:hover { background: var(--color-red-light); }
        /* Tab 1: Split Calculator specific */
        .pnl-container .controls { background: var(--color-bg-secondary); border-radius: var(--radius-lg); padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
        .pnl-container .ctrl-row { display: flex; align-items: center; gap: 12px; margin-bottom: 0.75rem; }
        .pnl-container .ctrl-row:last-child { margin-bottom: 0; }
        .pnl-container .ctrl-label { font-size: 13px; color: var(--color-text-secondary); width: 160px; flex-shrink: 0; }
        .pnl-container .ctrl-row input[type=range] { flex: 1; accent-color: var(--color-purple); }
        .pnl-container .ctrl-val { font-size: 14px; font-weight: 600; min-width: 100px; text-align: right; }
        .pnl-container .cap-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: var(--color-green-light); color: var(--color-green-dark); }
        .pnl-container .cap-badge.off { background: var(--color-bg-secondary); color: var(--color-text-tertiary); }
        .pnl-container .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 1.25rem; }
        .pnl-container .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 1.25rem; }
        .pnl-container .bar-wrap { margin-bottom: 7px; }
        .pnl-container .bar-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px; }
        .pnl-container .bar-label span:first-child { color: var(--color-text-secondary); }
        .pnl-container .bar-label span:last-child { font-weight: 600; }
        .pnl-container .bar-track { height: 5px; background: var(--color-bg-secondary); border-radius: 3px; overflow: hidden; }
        .pnl-container .bf-team { height: 100%; border-radius: 3px; background: var(--color-purple); transition: width 0.15s; }
        .pnl-container .bf-agent { height: 100%; border-radius: 3px; background: var(--color-teal); transition: width 0.15s; }
        .pnl-container .sep { margin: 1.5rem 0; border: none; border-top: 0.5px solid var(--color-border); }
        .pnl-container .solo { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 0.875rem 1rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .pnl-container .solo-agent { font-size: 14px; font-weight: 600; color: var(--color-green); }
        .pnl-container .solo-team { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
        .pnl-container .legend { display: flex; gap: 16px; margin-bottom: 1.25rem; flex-wrap: wrap; }
        .pnl-container .leg { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); }
        .pnl-container .leg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .pnl-container .principles-list { list-style: none; margin-bottom: 1.5rem; padding: 0; }
        .pnl-container .pi { display: flex; gap: 14px; padding: 1rem 0; border-bottom: 0.5px solid var(--color-border); }
        .pnl-container .pi:last-child { border-bottom: none; }
        .pnl-container .pi-num { font-size: 13px; font-weight: 700; color: var(--color-purple); min-width: 22px; flex-shrink: 0; padding-top: 1px; }
        .pnl-container .pi-text { font-size: 13px; font-weight: 600; line-height: 1.5; }
        .pnl-container .pi-sub { font-size: 12px; color: var(--color-text-secondary); margin-top: 4px; line-height: 1.6; }
        .pnl-container .loyalty-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 1rem; }
        .pnl-container .loy-card { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; text-align: center; }
        .pnl-container .loy-year { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; }
        .pnl-container .loy-bonus { font-size: 24px; font-weight: 700; color: var(--color-purple); }
        .pnl-container .loy-sub { font-size: 11px; color: var(--color-text-secondary); margin-top: 3px; }
        .pnl-container .loy-note { background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1rem; font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; margin-bottom: 1.5rem; }
        .pnl-container .loy-note b { color: var(--color-text); font-weight: 600; }
        .pnl-container .split-vis { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 6px; }
        .pnl-container .sva { background: var(--color-purple); transition: width 0.15s; }
        .pnl-container .svb { background: var(--color-teal); transition: width 0.15s; }
        .pnl-container .sv-labs { display: flex; justify-content: space-between; margin-top: 3px; }
        .pnl-container .sv-lab { font-size: 10px; color: var(--color-text-tertiary); }
        /* Tab 3: Recruiting specific */
        .pnl-container .phase-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 1.25rem; }
        .pnl-container .phase-card { background: var(--color-bg); border: 0.5px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; }
        .pnl-container .phase-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; margin-bottom: 10px; }
        .pnl-container .p1 { background: var(--color-purple-light); color: var(--color-purple-dark); }
        .pnl-container .p2 { background: var(--color-teal-light); color: var(--color-teal-dark); }
        .pnl-container .p3 { background: var(--color-amber-light); color: var(--color-amber-dark); }
        .pnl-container .phase-pct { font-size: 24px; font-weight: 700; margin-bottom: 5px; }
        .pnl-container .phase-pct.purple { color: var(--color-purple); }
        .pnl-container .phase-pct.teal { color: var(--color-teal); }
        .pnl-container .phase-pct.amber { color: var(--color-amber); }
        .pnl-container .phase-detail { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; }
        .pnl-container .rec-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 1.25rem; }
        .pnl-container .proj { background: var(--color-bg-secondary); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem; }
        .pnl-container .proj-title { font-size: 13px; font-weight: 600; margin-bottom: 1rem; }
        .pnl-container .proj-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .pnl-container .proj-col { text-align: center; }
        .pnl-container .proj-year { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 6px; }
        .pnl-container .proj-bw { height: 80px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 6px; }
        .pnl-container .proj-bar { width: 32px; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.3s; }
        .pnl-container .proj-amt { font-size: 12px; font-weight: 600; }
        @media (max-width: 640px) {
          .pnl-container .bp-grid, .pnl-container .bp-breakdown, .pnl-container .bp-summary, .pnl-container .cols, .pnl-container .meta, .pnl-container .loyalty-grid, .pnl-container .phase-grid, .pnl-container .rec-summary { grid-template-columns: 1fr; }
          .pnl-container .agent-ctrls { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {/* TAB BAR */}
      <div className="tab-bar">
        <button className={`tab ${activeTab === 'splits' ? 'active' : ''}`} onClick={() => setActiveTab('splits')}>Split calculator</button>
        <button className={`tab ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>Business profile</button>
        <button className={`tab ${activeTab === 'recruiting' ? 'active' : ''}`} onClick={() => setActiveTab('recruiting')}>Recruiting</button>
        <button className={`tab ${activeTab === 'pnl' ? 'active' : ''}`} onClick={() => setActiveTab('pnl')}>Team P&L</button>
      </div>

      {/* ════════════════════════════════════════════ */}
      {/* TAB 1: SPLIT CALCULATOR */}
      {/* ════════════════════════════════════════════ */}
      {activeTab === 'splits' && (
        <div>
          <div className="section-title">Key principles</div>
          <ul className="principles-list">
            <li className="pi"><span className="pi-num">1</span><div><div className="pi-text">You never make less than a referral</div><div className="pi-sub">The floor on any deal is the referral fee equivalent. No agent walks away with less.</div></div></li>
            <li className="pi"><span className="pi-num">2</span><div><div className="pi-text">You are rewarded for cultivating repeat clients</div><div className="pi-sub">Split percentages improve the more you nurture your own relationships. Cultivation is documented and recognized.</div></div></li>
            <li className="pi"><span className="pi-num">3</span><div><div className="pi-text">People will leave you for the same reasons they join</div><div className="pi-sub">Build a culture worth staying for. The reasons agents choose this team must remain true over time.</div></div></li>
            <li className="pi"><span className="pi-num">4</span><div><div className="pi-text">Leadership leads pipeline and makes introductions</div><div className="pi-sub">Leaders help agents build their pipeline and connect them with influential people and opportunities.</div></div></li>
            <li className="pi"><span className="pi-num">5</span><div><div className="pi-text">First two years: phone and dues are covered</div><div className="pi-sub">After year two, agents cover their own costs via automatic payment. No invoices.</div></div></li>
            <li className="pi"><span className="pi-num">6</span><div><div className="pi-text">Assistant model is earned, not given</div><div className="pi-sub">Triggered at 40 deals in a year or 20 deals in the first two quarters. If targets are not hit after year two, the agent shares the cost or loses the assistant.</div></div></li>
            <li className="pi"><span className="pi-num">7</span><div>
              <div className="pi-text">Commission cut accountability — team deals only</div>
              <div className="pi-sub">Applies only when an agent voluntarily cuts their commission to bring together a team deal (listing or buyer side). No penalty if the coop agent is offering below 2.5%. No penalty ever on personal or cultivated deals.</div>
              <table className="cut-table">
                <thead><tr><th>Cut number</th><th>Consequence</th></tr></thead>
                <tbody>
                  <tr><td>Cuts 1 and 2</td><td className="ok">No penalty</td></tr>
                  <tr><td>Cuts 3 and 4</td><td className="warn">50% of commission reduction shared with team + scripting workshop enrollment</td></tr>
                  <tr><td>Cut 5 and beyond</td><td className="bad">100% of commission reduction absorbed by agent's gross</td></tr>
                </tbody>
              </table>
            </div></li>
            <li className="pi"><span className="pi-num">8</span><div><div className="pi-text">Recruiting bonus: 5% of recruited agent GCI, max $7,500/year</div><div className="pi-sub">Paid at year end. Continues every year both agents remain on the team. See recruiting tab for full phase structure.</div></div></li>
            <li className="pi"><span className="pi-num">9</span><div><div className="pi-text">Celebrate the team, not just the top performers</div><div className="pi-sub">No top 10 leaderboard. Every member of a championship team earns a ring — regardless of individual stats.</div></div></li>
            <li className="pi"><span className="pi-num">10</span><div><div className="pi-text">High-volume agents keep more after 50 deals</div><div className="pi-sub">Every deal above 50 in a calendar year moves to Agent 85% / Team 15%, provided the agent has no assistant. Team lead split applies if applicable.</div></div></li>
            <li className="pi"><span className="pi-num">11</span><div><div className="pi-text">Loyalty bonuses are front-loaded and bought back</div><div className="pi-sub">Paid upfront at milestone. Recovered at 5% of agent share per personal deal in that calendar year, up to the bonus amount. Phase changes always at year end.</div></div></li>
          </ul>

          <hr className="sep" />
          <div className="section-title">Loyalty bonuses</div>
          <div className="loyalty-grid">
            <div className="loy-card"><div className="loy-year">3-year milestone</div><div className="loy-bonus">$3,000</div><div className="loy-sub">Paid upfront</div></div>
            <div className="loy-card"><div className="loy-year">5-year milestone</div><div className="loy-bonus">$5,000</div><div className="loy-sub">Paid upfront</div></div>
            <div className="loy-card"><div className="loy-year">10-year milestone</div><div className="loy-bonus">$10,000</div><div className="loy-sub">Paid upfront</div></div>
          </div>
          <div className="loy-note"><b>How the buyback works:</b> The bonus is paid in full at the anniversary. Throughout that calendar year, 5% of the agent share on every personal deal is redirected to the team as buyback until the full bonus amount is recovered. The final deal in the buyback period may recover a partial amount at a reduced percentage. Phase changes always take effect at the end of a calendar year.</div>

          <hr className="sep" />
          <div className="section-title">Split calculator</div>
          <div className="controls">
            <div className="ctrl-row">
              <span className="ctrl-label">Sale price</span>
              <input type="range" min="200000" max="2000000" step="10000" value={spState.price} onChange={(e) => spUpdate('price', e.target.value)} />
              <span className="ctrl-val">{fmt(spState.price)}</span>
            </div>
            <div className="ctrl-row">
              <span className="ctrl-label">Commission rate</span>
              <input type="range" min="1" max="4" step="0.25" value={spState.rate} onChange={(e) => spUpdate('rate', e.target.value)} />
              <span className="ctrl-val">{spState.rate.toFixed(2).replace(/\.?0+$/, '')}%</span>
            </div>
            <div className="ctrl-row">
              <span className="ctrl-label">Brokerage cap hit?</span>
              <input type="range" min="0" max="1" step="1" value={spState.cap} onChange={(e) => spUpdate('cap', e.target.value)} />
              <span className="ctrl-val"><span className={`cap-badge${spState.cap === 0 ? ' off' : ''}`}>{spState.cap === 1 ? 'Yes' : 'No'}</span></span>
            </div>
          </div>

          <div className="meta">
            <div className="metric"><div className="metric-label">GCI</div><div className="metric-val">{fmt(spCalc.gci)}</div></div>
            <div className="metric"><div className="metric-label">Brokerage (5% of agent share)</div><div className="metric-val red">{spCalc.c ? '$0 (cap reached)' : '5% of agent share'}</div></div>
            <div className="metric"><div className="metric-label">Net to split</div><div className="metric-val green">{fmt(spCalc.gci)}</div></div>
          </div>

          <div className="cols">
            <div>
              <div className="section-title">Listing side</div>
              {spCalc.lS.map((s, i) => (
                <div key={i} className="card">
                  <div className="card-title">{s.label}</div>
                  <div className="bar-wrap">
                    <div className="bar-label"><span>Team {Math.round(s.t * 100)}%</span><span>{fmt(spCalc.gci * s.t)}</span></div>
                    <div className="bar-track"><div className="bf-team" style={{ width: (s.t * 100) + '%' }}></div></div>
                  </div>
                  <div className="bar-wrap">
                    <div className="bar-label"><span>Agent {Math.round(s.a * 100)}%</span><span>{fmt(ab(spCalc.gci * s.a, spCalc.c))}</span></div>
                    <div className="bar-track"><div className="bf-agent" style={{ width: (s.a * 100) + '%' }}></div></div>
                  </div>
                </div>
              ))}
              <div className="solo">
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '600' }}>Exclusive listing (no marketing)</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Agent 90% / Team 10%</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="solo-agent">{fmt(ab(spCalc.gci * 0.90, spCalc.c))} agent</div>
                  <div className="solo-team">{fmt(spCalc.gci * 0.10)} team</div>
                </div>
              </div>
            </div>
            <div>
              <div className="section-title">Buyer side</div>
              {spCalc.bS.map((s, i) => (
                <div key={i} className="card">
                  <div className="card-title">{s.label}</div>
                  <div className="bar-wrap">
                    <div className="bar-label"><span>Team {Math.round(s.t * 100)}%</span><span>{fmt(spCalc.gci * s.t)}</span></div>
                    <div className="bar-track"><div className="bf-team" style={{ width: (s.t * 100) + '%' }}></div></div>
                  </div>
                  <div className="bar-wrap">
                    <div className="bar-label"><span>Agent {Math.round(s.a * 100)}%</span><span>{fmt(ab(spCalc.gci * s.a, spCalc.c))}</span></div>
                    <div className="bar-track"><div className="bf-agent" style={{ width: (s.a * 100) + '%' }}></div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="legend">
            <div className="leg"><div className="leg-dot" style={{ background: 'var(--color-purple)' }}></div>Team</div>
            <div className="leg"><div className="leg-dot" style={{ background: 'var(--color-teal)' }}></div>Agent (after 5% brokerage)</div>
          </div>
          <div className="footnote">All figures pre-HST. Brokerage is 5% of agent share to a $5,000 annual cap. Commission cut rules apply to team deals only where the agent voluntarily reduces commission to bring the deal together.</div>
        </div>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* TAB 2: BUSINESS PROFILE */}
      {/* ════════════════════════════════════════════ */}
      {activeTab === 'profile' && (
        <div>
          <div className="bp-grid">
            <div className="bp-ctrl">
              <div className="bp-ctrl-title">Deal volume</div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Deals per year</span><span className="sl-val">{Math.round(bpState.deals)} deals</span></div>
                <input type="range" min="5" max="80" step="1" value={bpState.deals} onChange={(e) => bpUpdate('deals', e.target.value)} />
              </div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Commission rate</span><span className="sl-val">{bpState.rate.toFixed(2).replace(/\.?0+$/, '')}%</span></div>
                <input type="range" min="2" max="2.5" step="0.25" value={bpState.rate} onChange={(e) => bpUpdate('rate', e.target.value)} />
              </div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Avg sale price</span><span className="sl-val">{fmt(bpState.price)}</span></div>
                <input type="range" min="300000" max="1500000" step="25000" value={bpState.price} onChange={(e) => bpUpdate('price', e.target.value)} />
              </div>
            </div>
            <div className="bp-ctrl">
              <div className="bp-ctrl-title">Listing vs buyer mix</div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Listings</span><span className="sl-val">{Math.round(bpState.list)}%</span></div>
                <input type="range" min="0" max="100" step="5" value={bpState.list} onChange={(e) => bpUpdate('list', e.target.value)} />
                <div className="split-vis">
                  <div className="sva" style={{ width: bpState.list + '%' }}></div>
                  <div className="svb" style={{ width: (100 - bpState.list) + '%' }}></div>
                </div>
                <div className="sv-labs"><span className="sv-lab">Listings</span><span className="sv-lab">Buyers</span></div>
              </div>
            </div>
            <div className="bp-ctrl">
              <div className="bp-ctrl-title">Lead source mix</div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Team sourced</span><span className="sl-val">{Math.round(bpState.team)}%</span></div>
                <input type="range" min="0" max="100" step="5" value={bpState.team} onChange={(e) => bpUpdate('team', e.target.value)} />
                <div className="split-vis">
                  <div className="sva" style={{ width: bpState.team + '%' }}></div>
                  <div className="svb" style={{ width: (100 - bpState.team) + '%' }}></div>
                </div>
                <div className="sv-labs"><span className="sv-lab">Team sourced</span><span className="sv-lab">Self cultivated</span></div>
              </div>
            </div>
            <div className="bp-ctrl">
              <div className="bp-ctrl-title">Brokerage</div>
              <div className="sl-row">
                <div className="sl-lrow"><span className="sl-label">Annual cap hit?</span><span className="sl-val"><span className={`cap-badge${bpState.cap === 0 ? ' off' : ''}`}>{bpState.cap === 1 ? 'Yes' : 'No'}</span></span></div>
                <input type="range" min="0" max="1" step="1" value={bpState.cap} onChange={(e) => bpUpdate('cap', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="bp-summary">
            <div className="metric"><div className="metric-label">Total GCI</div><div className="metric-val">{fmt(bpCalc.totalGci)}</div></div>
            <div className="metric"><div className="metric-label">Weighted agent share</div><div className="metric-val" style={{ color: 'var(--color-purple)' }}>{pct(bpCalc.blendedPct * 100)}{bpCalc.overDeals > 0 ? ' (blended)' : ''}</div></div>
            <div className="metric"><div className="metric-label">Est. annual take-home</div><div className="metric-val green">{fmt(bpCalc.agentNet)}</div></div>
            <div className="metric"><div className="metric-label">Per deal average</div><div className="metric-val">{bpState.deals > 0 ? fmt(bpCalc.agentNet / bpState.deals) : '—'}</div></div>
          </div>

          <div className="section-title">Deal breakdown</div>
          <div className="bp-breakdown">
            <div className="bpbc">
              <div className="bpbc-title">Listing side</div>
              {bpCalc.sets.filter(s => s.side === 'list').map((s, i) => (
                <div key={i} className="bpbc-row">
                  <div><div className="bpbc-name">{s.label}</div><div className="bpbc-desc">{s.desc}</div></div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="bpbc-amt">{fmt(ab(bpCalc.gci * s.a, bpCalc.c))}</div>
                    <div className="bpbc-pct">{s.pctLabel}</div>
                    <div className="bpbc-w">{Math.round(s.w * 100)}% of your deals</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bpbc">
              <div className="bpbc-title">Buyer side</div>
              {bpCalc.sets.filter(s => s.side === 'buyer').map((s, i) => (
                <div key={i} className="bpbc-row">
                  <div><div className="bpbc-name">{s.label}</div><div className="bpbc-desc">{s.desc}</div></div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="bpbc-amt">{fmt(ab(bpCalc.gci * s.a, bpCalc.c))}</div>
                    <div className="bpbc-pct">{s.pctLabel}</div>
                    <div className="bpbc-w">{Math.round(s.w * 100)}% of your deals</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="story-box">
            <div className="story-title">{bpCalc.storyTitle}</div>
            <div className="story-text" dangerouslySetInnerHTML={{ __html: bpCalc.storyText }} />
          </div>
          <div className="footnote">All figures pre-HST. Agent take-home shown after 5% brokerage deduction on agent share unless cap is hit. Weighted average blends your listing/buyer mix with your team sourced/cultivated mix. As your cultivated book grows, your weighted share increases.</div>
        </div>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* TAB 3: RECRUITING */}
      {/* ════════════════════════════════════════════ */}
      {activeTab === 'recruiting' && (
        <div>
          <div className="rec-hero">
            <div className="rec-hero-title">Jonathan Wallace — recruiting revenue share</div>
            <div className="rec-hero-sub">Every agent you recruit and support generates annual income — paid at year end. The team handles onboarding and admin. You focus on people and mentorship in year one.</div>
          </div>

          <div className="section-title">Revenue share structure</div>
          <div className="phase-grid">
            <div className="phase-card"><span className="phase-badge p1">Year 1</span><div className="phase-pct purple">5% of GCI</div><div className="phase-detail">Max $7,500. Active mentorship expected. Team handles all onboarding and administration.</div></div>
            <div className="phase-card"><span className="phase-badge p2">Years 2 to 5</span><div className="phase-pct teal">5% of GCI</div><div className="phase-detail">Max $7,500. No mentorship required. Fully passive income. Paid at end of calendar year.</div></div>
            <div className="phase-card"><span className="phase-badge p3">Year 5 onwards</span><div className="phase-pct amber">2.5% of GCI</div><div className="phase-detail">No cap. No mentorship. Continues indefinitely as long as both agents remain on the team.</div></div>
          </div>

          <div className="rec-summary">
            <div className="metric"><div className="metric-label">Total annual rev share</div><div className="metric-val green">{fmt(recCalc.total)}</div></div>
            <div className="metric"><div className="metric-label">Recruited agents</div><div className="metric-val" style={{ color: 'var(--color-purple)' }}>{recCalc.count}</div></div>
            <div className="metric"><div className="metric-label">Avg per agent</div><div className="metric-val">{recCalc.count > 0 ? fmt(recCalc.avg) : '—'}</div></div>
          </div>

          <div className="section-title">Your recruited agents</div>
          <div className="agents-list">
            {recCalc.agentData.map(a => (
              <div key={a.id} className="agent-row">
                <div className="agent-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="agent-av">{initials(a.name)}</div>
                    <input className="agent-name-input" type="text" value={a.name} onChange={(e) => updateRecAgentName(a.id, e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`phase-badge ${a.phaseCls}`}>{a.phaseLabel}</span>
                    <button className="remove-btn" onClick={() => removeRecAgent(a.id)}>Remove</button>
                  </div>
                </div>
                <div className="agent-ctrls" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div>
                    <div className="ac-label">Annual GCI</div>
                    <input type="range" min="50000" max="500000" step="5000" value={a.gci} onChange={(e) => updateRecAgent(a.id, 'gci', e.target.value)} />
                    <div className="ac-val">{fmt(a.gci)}</div>
                  </div>
                  <div>
                    <div className="ac-label">Years on team</div>
                    <input type="range" min="1" max="15" step="1" value={a.year} onChange={(e) => updateRecAgent(a.id, 'year', e.target.value)} />
                    <div className="ac-val">{a.year} yr{a.year > 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div className="ac-label">Your rate</div>
                    <div style={{ height: '18px' }}></div>
                    <div className="ac-val">{a.pctStr}{a.capped ? ' (capped)' : ''}</div>
                  </div>
                </div>
                <div className="agent-result">
                  <div className="ar-breakdown">{fmt(a.gci)} × {a.pctStr}{a.capped ? ' → capped at $7,500' : ''}</div>
                  <div>
                    <div className="ar-payout">{fmt(a.payout)}</div>
                    {a.mentor && <div className="ar-mentor">Mentorship year</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="add-btn" onClick={addRecAgent}>+ Add recruited agent</button>

          <div className="proj">
            <div className="proj-title">5-year revenue share projection</div>
            <div className="proj-grid">
              {recCalc.proj.map(p => {
                const h = Math.max((p.amt / recCalc.projMax) * 80, 2);
                return (
                  <div key={p.year} className="proj-col">
                    <div className="proj-year">Year {p.year}</div>
                    <div className="proj-bw"><div className="proj-bar" style={{ height: h + 'px', background: p.barColor }}></div></div>
                    <div className="proj-amt">{fmt(p.amt)}</div>
                  </div>
                );
              })}
            </div>
            <div className="legend" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <div className="leg"><div className="leg-dot" style={{ background: '#534AB7' }}></div>Year 1 (5%, mentorship)</div>
              <div className="leg"><div className="leg-dot" style={{ background: '#1D9E75' }}></div>Years 2–5 (5%, passive)</div>
              <div className="leg"><div className="leg-dot" style={{ background: '#BA7517' }}></div>Year 5+ (2.5%, no cap)</div>
            </div>
          </div>
          <div className="footnote">Revenue share paid at end of each calendar year. Phase changes take effect at end of calendar year — never mid-year. Cap of $7,500 applies per agent in years 1 through 5. After year 5, 2.5% with no cap continues indefinitely as long as both agents remain on the team.</div>
        </div>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* TAB 4: TEAM P&L */}
      {/* ════════════════════════════════════════════ */}
      {activeTab === 'pnl' && (
        <div>
      {/* HERO BOX */}
      <div className="rec-hero">
        <div className="rec-hero-title">Team owner profit & loss</div>
        <div className="rec-hero-sub">Model the true cost of running your team. Revenue is calculated from the split structure. Expenses include every hard cost of carrying agents, listings, and overhead — including expired listings that generate zero revenue.</div>
      </div>

      {/* GLOBAL COST SETTINGS */}
      <div className="section-title">Global cost settings</div>
      <div className="bp-grid">
        <div className="bp-ctrl">
          <div className="bp-ctrl-title">Listing & buyer costs</div>
          <div className="sl-row">
            <div className="sl-lrow"><span className="sl-label">Cost per listing</span><span className="sl-val">{fmt(pnlState.listingCost)}</span></div>
            <input type="range" min="750" max="1500" step="50" value={pnlState.listingCost} onChange={(e) => pnlU('listingCost', e.target.value)} />
          </div>
          <div className="sl-row">
            <div className="sl-lrow"><span className="sl-label">Listing expire rate</span><span className="sl-val">{pct(pnlState.expireRate)}</span></div>
            <input type="range" min="5" max="40" step="5" value={pnlState.expireRate} onChange={(e) => pnlU('expireRate', e.target.value)} />
          </div>
          <div className="sl-row">
            <div className="sl-lrow"><span className="sl-label">Buyer cost per deal</span><span className="sl-val">{fmt(pnlState.buyerCost)}</span></div>
            <input type="range" min="250" max="1000" step="25" value={pnlState.buyerCost} onChange={(e) => pnlU('buyerCost', e.target.value)} />
          </div>
        </div>
        <div className="bp-ctrl">
          <div className="bp-ctrl-title">Marketing & owner cap</div>
          <div className="sl-row">
            <div className="sl-lrow"><span className="sl-label">Marketing/month</span><span className="sl-val">{fmt(pnlState.marketing)}</span></div>
            <input type="range" min="1000" max="15000" step="500" value={pnlState.marketing} onChange={(e) => pnlU('marketing', e.target.value)} />
          </div>
          <div className="sl-row">
            <div className="sl-lrow"><span className="sl-label">Owner team-share cap</span><span className="sl-val" style={{ color: 'var(--color-purple)', fontWeight: '600' }}>{fmt(pnlState.ownerTeamCap)}</span></div>
            <input type="range" min="100000" max="500000" step="25000" value={pnlState.ownerTeamCap} onChange={(e) => pnlU('ownerTeamCap', e.target.value)} />
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>Owners keep 100% of GCI after their team share hits this cap</div>
          </div>
        </div>
      </div>

      {/* AGENT ROSTER */}
      <div className="section-title">Agent roster</div>
      <div className="agents-list">
        {pnlAgents.sort((a, b) => (a.role === 'agent' ? 1 : 0) - (b.role === 'agent' ? 1 : 0)).map((a, idx, arr) => {
          const isOwner = a.role === 'owner' || a.role === 'coowner';
          const showSep = idx > 0 && !isOwner && (arr[idx - 1].role === 'owner' || arr[idx - 1].role === 'coowner');
          const lP = a.listPct / 100, bP = 1 - lP, tP = a.teamPct / 100, cP = 1 - tP;
          const wA = getWA(lP, bP, tP, cP);
          const teamPct = 1 - wA;
          const gci = a.deals * a.avgPrice * (a.commRate / 100);
          const rawTeamRev = gci * teamPct;
          const cap = pnlState.ownerTeamCap;
          const teamRev = isOwner ? Math.min(rawTeamRev, cap) : rawTeamRev;
          const capExcess = isOwner ? Math.max(rawTeamRev - cap, 0) : 0;
          const recruiter = pnlAgents.find(r => r.id === a.recruitedBy);
          const recCost = recruiter ? calcRecBonus(gci, a.yearsOnTeam) : 0;
          const recEarned = pnlAgents.filter(r => r.recruitedBy === a.id).reduce((sum, r) => {
            const rGci = r.deals * r.avgPrice * (r.commRate / 100);
            return sum + calcRecBonus(rGci, r.yearsOnTeam);
          }, 0);
          const agentKeep = gci * wA + capExcess;
          const numOwners = pnlAgents.filter(x => x.role === 'owner' || x.role === 'coowner').length;
          const maxOwn = numOwners > 1 ? 100 - ((numOwners - 1) * 5) : 100;

          return (
            <div key={a.id}>
              {showSep && (
                <div style={{ borderTop: '2px solid var(--color-border)', margin: '12px 0 4px', paddingTop: '4px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>Agents</div>
              )}
              <div className="agent-row" style={isOwner ? { background: 'var(--color-purple-light)', border: '0.5px solid var(--color-purple)', borderLeft: '3px solid var(--color-purple)' } : {}}>
                <div className="agent-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="agent-av" style={isOwner ? { background: 'var(--color-purple)', color: 'white' } : {}}>{initials(a.name)}</div>
                    <input className="agent-name-input" type="text" value={a.name} onChange={(e) => updatePnlAgentName(a.id, e.target.value)} style={{ width: '120px' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '4px', border: '0.5px solid var(--color-border)', background: isOwner ? 'var(--color-purple-light)' : 'var(--color-bg-secondary)', color: isOwner ? 'var(--color-purple-dark)' : 'var(--color-text-secondary)', fontWeight: isOwner ? '600' : '400' }} value={a.role} onChange={(e) => updatePnlAgent(a.id, 'role', e.target.value)}>
                      <option value="agent">Agent</option>
                      <option value="owner">Owner</option>
                      <option value="coowner">Co-Owner</option>
                    </select>
                    <select style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '4px', border: '0.5px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }} value={a.recruitedBy} onChange={(e) => updatePnlAgent(a.id, 'recruitedBy', e.target.value)}>
                      <option value="0">Direct hire</option>
                      {pnlAgents.map(m => m.id !== a.id && <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button className="remove-btn" onClick={() => removePnlAgent(a.id)}>Remove</button>
                  </div>
                </div>
                <div className="agent-ctrls">
                  <div>
                    <div className="ac-label">Deals/year</div>
                    <input type="range" min="5" max="75" step="1" value={a.deals} onChange={(e) => updatePnlAgent(a.id, 'deals', e.target.value)} />
                    <div className="ac-val">{a.deals} deals</div>
                  </div>
                  <div>
                    <div className="ac-label">Avg sale price</div>
                    <input type="range" min="300000" max="1500000" step="25000" value={a.avgPrice} onChange={(e) => updatePnlAgent(a.id, 'avgPrice', e.target.value)} />
                    <div className="ac-val">{fmt(a.avgPrice)}</div>
                  </div>
                  <div>
                    <div className="ac-label">Commission %</div>
                    <input type="range" min="2" max="2.5" step="0.25" value={a.commRate} onChange={(e) => updatePnlAgent(a.id, 'commRate', e.target.value)} />
                    <div className="ac-val">{a.commRate.toFixed(2).replace(/\.?0+$/, '')}%</div>
                  </div>
                  <div>
                    <div className="ac-label">Years on team</div>
                    <input type="range" min="1" max="15" step="1" value={a.yearsOnTeam} onChange={(e) => updatePnlAgent(a.id, 'yearsOnTeam', e.target.value)} />
                    <div className="ac-val">{a.yearsOnTeam} yr{a.yearsOnTeam > 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div className="ac-label">Listing %</div>
                    <input type="range" min="0" max="100" step="5" value={a.listPct} onChange={(e) => updatePnlAgent(a.id, 'listPct', e.target.value)} />
                    <div className="ac-val">{a.listPct}% list / {100 - a.listPct}% buy</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="ac-label">Team sourced %</div>
                    <input type="range" min="0" max="100" step="5" value={a.teamPct} onChange={(e) => updatePnlAgent(a.id, 'teamPct', e.target.value)} />
                    <div className="ac-val">{a.teamPct}% team / {100 - a.teamPct}% cult</div>
                  </div>
                </div>
                {isOwner && (
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <div className="ac-label">Ownership % <span style={{ fontWeight: '400', color: 'var(--color-text-tertiary)' }}>(linked — always totals 100%)</span></div>
                      <input type="range" min="5" max={maxOwn} step="1" value={Math.round(a.ownerPct)} onChange={(e) => updatePnlAgent(a.id, 'ownerPct', e.target.value)} />
                      <div className="ac-val" style={{ color: 'var(--color-purple)', fontWeight: '700' }}>{Math.round(a.ownerPct)}%</div>
                    </div>
                  </div>
                )}
                <div className="agent-result">
                  <div className="ar-breakdown" dangerouslySetInnerHTML={{
                    __html: `<span style="font-weight:600">GCI ${fmt(gci)}</span> → <span style="color:var(--color-green);font-weight:600">${isOwner ? 'Kept' : 'Agent share'} ${fmt(agentKeep)} (${Math.round(wA * 100)}%${capExcess > 0 ? ' + ' + fmt(capExcess) + ' over cap' : ''})</span> · <span style="color:var(--color-amber);font-weight:600">Team ${fmt(teamRev)}${isOwner && capExcess > 0 ? ' (capped at ' + fmt(cap) + ')' : ' (' + Math.round(teamPct * 100) + '%)'}` +
                    (isOwner ? `</span> · <span style="color:var(--color-purple);font-weight:600">${a.ownerPct}% ownership` : `</span>`) +
                    (recEarned > 0 ? `</span> · <span style="color:var(--color-teal);font-weight:600">Rec earned +${fmt(recEarned)}` : `</span>`) +
                    (recCost > 0 ? `</span> · <span style="color:var(--color-purple)">Rec bonus ${fmt(recCost)} → ${recruiter?.name}` : `</span>`)
                  }} />
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-green)' }}>{fmt(agentKeep + recEarned)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>take-home</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="add-btn" onClick={addPnlAgent}>+ Add agent</button>

      {/* SUMMARY METRICS */}
      <div className="bp-summary">
        <div className="metric"><div className="metric-label">Total annual revenue</div><div className="metric-val green">{fmt(pnlData.totalTeamRev)}</div></div>
        <div className="metric"><div className="metric-label">Total annual expenses</div><div className="metric-val red">{fmt(pnlData.totalExp)}</div></div>
        <div className="metric"><div className="metric-label">Net profit</div><div className="metric-val" style={{ color: pnlData.netProfit >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>{fmt(pnlData.netProfit)}</div></div>
        <div className="metric"><div className="metric-label">Profit per agent</div><div className="metric-val" style={{ color: pnlData.netProfit >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>{pnlData.numAgents > 0 ? fmt(pnlData.netProfit / pnlData.numAgents) : '—'}</div></div>
      </div>

      {/* BREAKDOWN */}
      <div className="section-title">Breakdown</div>
      <div className="bp-breakdown">
        <div className="bpbc">
          <div className="bpbc-title">Revenue</div>
          <div className="bpbc-row">
            <div><div className="bpbc-name">Agent deals — team's share</div><div className="bpbc-desc">{pnlData.numAgents} agents · {Math.round(pnlData.agentOnlyDeals)} deals</div></div>
            <div style={{ textAlign: 'right' }}><div className="bpbc-amt">{fmt(pnlData.agentOnlyRev)}</div></div>
          </div>
          <div className="bpbc-row">
            <div><div className="bpbc-name">Owner deals — team share</div><div className="bpbc-desc">{pnlData.allOwnersList.length} owner{pnlData.allOwnersList.length > 1 ? 's' : ''} · team share from weighted split</div></div>
            <div style={{ textAlign: 'right' }}><div className="bpbc-amt">{fmt(pnlData.ownerRev)}</div></div>
          </div>
          <div className="bpbc-row" style={{ borderTop: '1.5px solid var(--color-border)', paddingTop: '10px' }}>
            <div><div className="bpbc-name" style={{ fontWeight: '700' }}>Total revenue</div></div>
            <div style={{ textAlign: 'right' }}><div className="bpbc-amt" style={{ fontSize: '15px' }}>{fmt(pnlData.totalTeamRev)}</div></div>
          </div>
        </div>
        <div className="bpbc">
          <div className="bpbc-title">Expenses <span style={{ fontWeight: '400', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>(toggle items on/off)</span></div>
          {[
            { key: 'admin', name: 'Admin salary + 13% burden', desc: pnlData.adminAnnual, hasSlider: true, min: 45000, max: 90000, value: pnlState.adminSalary, onChange: (v) => pnlU('adminSalary', v) },
            { key: 'bonus', name: 'Admin bonus', desc: pnlData.adminBonus, hasSlider: true, min: 100, max: 500, value: pnlState.adminBonusRate, onChange: (v) => pnlU('adminBonusRate', v) },
            { key: 'rent', name: 'Office rent', desc: pnlData.rentAnnual, hasSlider: true, min: 1000, max: 5000, value: pnlState.rentCost, onChange: (v) => pnlU('rentCost', v) },
            { key: 'mkt', name: 'Marketing & lead gen', desc: pnlData.mktAnnual, hasSlider: true, min: 1000, max: 15000, value: pnlState.marketing, onChange: (v) => pnlU('marketing', v) },
            { key: 'crm', name: 'CRM — Follow Up Boss', desc: pnlData.crmAnnual, hasSlider: true, min: 25, max: 150, value: pnlState.crmCost, onChange: (v) => pnlU('crmCost', v) },
            { key: 'sw', name: 'Software & tools', desc: pnlData.swAnnual, hasSlider: true, min: 25, max: 150, value: pnlState.swCost, onChange: (v) => pnlU('swCost', v) },
            { key: 'list', name: 'Listing costs (incl. expired)', desc: pnlData.listCostAnnual, hasSlider: true, min: 750, max: 1500, value: pnlState.listingCost, onChange: (v) => pnlU('listingCost', v) },
            { key: 'buyer', name: 'Buyer deal costs', desc: pnlData.buyerCostAnnual, hasSlider: true, min: 50, max: 500, value: pnlState.buyerCost, onChange: (v) => pnlU('buyerCost', v) },
            { key: 'onboard', name: 'Agent onboarding', desc: pnlData.onboard, hasSlider: true, min: 200, max: 2000, value: pnlState.onboardCost, onChange: (v) => pnlU('onboardCost', v) },
            { key: 'recbonus', name: 'Recruiting bonuses', desc: pnlData.totalRecBonus, hasSlider: false },
            { key: 'brok', name: 'Owner brokerage — 5%, $5k cap', desc: pnlData.ownerBrok, hasSlider: false },
            { key: 'web', name: 'Website & hosting', desc: pnlData.webAnnual, hasSlider: true, min: 100, max: 1000, value: pnlState.webCost, onChange: (v) => pnlU('webCost', v) },
            { key: 'events', name: 'Client events', desc: pnlData.eventsAnnual, hasSlider: true, min: 1000, max: 15000, value: pnlState.eventsCost, onChange: (v) => pnlU('eventsCost', v) },
            { key: 'billboard', name: 'Billboards', desc: pnlData.billboardAnnual, hasSlider: true, min: 500, max: 3000, value: pnlState.billboardCost, onChange: (v) => pnlU('billboardCost', v) },
            { key: 'office', name: 'Office peripherals & supplies', desc: pnlData.officeAnnual, hasSlider: true, min: 200, max: 1500, value: pnlState.officeCost, onChange: (v) => pnlU('officeCost', v) },
          ].map(exp => (
            <div key={exp.key} className={`bpbc-row${!expToggles[exp.key] ? ' disabled' : ''}`}>
              <label className="exp-toggle">
                <input type="checkbox" checked={expToggles[exp.key]} onChange={(e) => togExp(exp.key, e.target.checked)} />
                <span className="slider"></span>
              </label>
              <div style={{ flex: 1 }}>
                <div className="bpbc-name">{exp.name}</div>
                <div className="bpbc-desc">
                  {exp.key === 'admin' && `${fmt(pnlState.adminSalary)} base — CPP, EI, vacation`}
                  {exp.key === 'bonus' && `${fmt(pnlState.adminBonusRate)}/deal after 80 deals`}
                  {exp.key === 'rent' && `${fmt(pnlState.rentCost)}/month`}
                  {exp.key === 'mkt' && fmt(pnlState.marketing) + '/month'}
                  {exp.key === 'crm' && `${fmt(pnlState.crmCost)} × ${pnlData.numAll} members × 12 mo`}
                  {exp.key === 'sw' && `${fmt(pnlState.swCost)} × ${pnlData.numAll} members × 12 mo`}
                  {exp.key === 'list' && `${Math.round(pnlData.allListingsTaken)} listings taken (${Math.round(pnlData.expiredCount)} expired) × ${fmt(pnlState.listingCost)}`}
                  {exp.key === 'buyer' && `${Math.round(pnlData.totalBuyers)} buyer deals × ${fmt(pnlState.buyerCost)}`}
                  {exp.key === 'onboard' && `${fmt(pnlState.onboardCost)} × ${pnlData.numAll} roster members`}
                  {exp.key === 'recbonus' && (pnlData.totalRecBonus > 0 ? '5%/2.5% of recruited agents\' GCI' : 'No recruited agents')}
                  {exp.key === 'brok' && `${pnlData.allOwnersList.length} owner${pnlData.allOwnersList.length > 1 ? 's' : ''} — 5% each, $5k cap`}
                  {exp.key === 'web' && `${fmt(pnlState.webCost)}/month`}
                  {exp.key === 'events' && 'Annual client event budget'}
                  {exp.key === 'billboard' && `${fmt(pnlState.billboardCost)}/month`}
                  {exp.key === 'office' && 'Pens, paper, photocopies, toner'}
                </div>
                {exp.hasSlider && (
                  <div style={{ marginTop: '4px' }}>
                    <input type="range" min={exp.min} max={exp.max} step={exp.key === 'sw' || exp.key === 'crm' || exp.key === 'web' ? 5 : exp.key === 'adminBonusRate' ? 25 : exp.key === 'rentCost' ? 250 : exp.key === 'marketing' ? 500 : exp.key === 'eventsCost' ? 500 : exp.key === 'billboardCost' ? 100 : 50} value={exp.value} onChange={(e) => exp.onChange(e.target.value)} style={{ width: '100%', accentColor: 'var(--color-purple)' }} />
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="bpbc-amt" style={{ color: 'var(--color-red)' }}>{fmt(exp.desc)}</div>
              </div>
            </div>
          ))}
          {customExps.map(e => {
            const annual = e.freq === 'monthly' ? e.amount * 12 : e.amount;
            return (
              <div key={e.id} className={`bpbc-row${e.enabled === false ? ' disabled' : ''}`} style={{ gap: '8px' }}>
                <label className="exp-toggle">
                  <input type="checkbox" checked={e.enabled !== false} onChange={(e2) => togCustomExp(e.id, e2.target.checked)} />
                  <span className="slider"></span>
                </label>
                <div style={{ flex: 1 }}>
                  <div className="bpbc-name"><input className="custom-exp-input" type="text" value={e.name} onChange={(e2) => updateCustomExp(e.id, 'name', e2.target.value)} /></div>
                  <div className="bpbc-desc" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>$</span>
                    <input className="custom-exp-amt" type="number" value={e.amount} onChange={(e2) => updateCustomExp(e.id, 'amount', e2.target.value)} style={{ width: '70px' }} />
                    <button className="custom-exp-freq" onClick={() => toggleCustomFreq(e.id)}>{e.freq}</button>
                    <button className="custom-exp-remove" onClick={() => removeCustomExp(e.id)}>×</button>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="bpbc-amt" style={{ color: 'var(--color-red)' }}>{fmt(annual)}</div>
                  <div className="bpbc-pct">/year</div>
                </div>
              </div>
            );
          })}
          <div style={{ paddingTop: '8px' }}><button className="add-btn" style={{ marginBottom: '0' }} onClick={addCustomExp}>+ Add custom expense</button></div>
          <div className="bpbc-row" style={{ borderTop: '1.5px solid var(--color-border)', paddingTop: '10px' }}>
            <div style={{ flex: 1 }}><div className="bpbc-name" style={{ fontWeight: '700' }}>Total expenses</div></div>
            <div style={{ textAlign: 'right' }}><div className="bpbc-amt" style={{ color: 'var(--color-red)', fontSize: '15px' }}>{fmt(pnlData.totalExp)}</div></div>
          </div>
        </div>
      </div>

      {/* STORY BOX */}
      <div className="story-box">
        <div className="story-title">{pnlData.numAgents}-agent, {pnlData.ownerCount}-owner team — {pnlData.health}</div>
        <div className="story-text" dangerouslySetInnerHTML={{
          __html: `Everyone runs through the <b>standard weighted split</b>. Team share from <b>${Math.round(pnlData.totalDeals)} total deals</b> generates <b>${fmt(pnlData.totalTeamRev)}</b> in revenue against <b>${fmt(pnlData.totalExp)}</b> in expenses — <b>${pnlData.margin}% margin</b>. After <b>${Math.round(pnlState.reinvestPct)}% carryover</b> (${fmt(pnlData.reinvestAmt)}), <b>${fmt(pnlData.distributableProfit)}</b> is distributed to ${pnlData.ownerCount} owner${pnlData.ownerCount > 1 ? 's' : ''}.${pnlData.listDrag}${pnlData.recNote}`
        }} />
      </div>

      {/* PROFIT DISTRIBUTION */}
      <div className="section-title">Profit distribution</div>
      {pnlData.ownerDist.length === 0 ? (
        <div className="card">No owners to distribute profit</div>
      ) : (
        pnlData.ownerDist.map(o => (
          <div key={o.id} className="card" style={{ borderLeft: '3px solid var(--color-purple)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="agent-av" style={{ background: 'var(--color-purple)', color: 'white' }}>{initials(o.name)}</div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>{o.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{o.normalizedPct}% ownership · {o.role === 'coowner' ? 'Co-Owner' : 'Owner'}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--color-green)' }}>{fmt(o.totalTakeHome)}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>total take-home</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              <div className="metric" style={{ padding: '8px' }}>
                <div className="metric-label">GCI ({Math.round(o.wA * 100)}% agent share)</div>
                <div className="metric-val" style={{ fontSize: '14px' }}>{fmt(o.gci)}</div>
              </div>
              <div className="metric" style={{ padding: '8px' }}>
                <div className="metric-label">Agent share (kept)</div>
                <div className="metric-val" style={{ fontSize: '14px', color: 'var(--color-green)' }}>{fmt(o.agentShare)}</div>
              </div>
              <div className="metric" style={{ padding: '8px' }}>
                <div className="metric-label">Team share (to pool)</div>
                <div className="metric-val" style={{ fontSize: '14px', color: 'var(--color-amber)' }}>{fmt(o.teamShare)}</div>
              </div>
              <div className="metric" style={{ padding: '8px' }}>
                <div className="metric-label">Profit share ({o.normalizedPct}%)</div>
                <div className="metric-val" style={{ fontSize: '14px', color: 'var(--color-purple)' }}>{fmt(o.profitShare)}</div>
              </div>
            </div>
          </div>
        ))
      )}

      {/* PROFIT CARRYOVER & CAPITAL PLANNING */}
      <div className="section-title">Profit carryover & capital planning</div>
      <div className="bp-grid">
        <div className="bp-ctrl">
          <div className="bp-ctrl-title">Profit carryover <span style={{ fontWeight: '400', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>— agreed by all owners</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <div>
              <div className="bpbc-name">Net profit</div>
              <div className="bpbc-desc">Team revenue minus all expenses</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bpbc-amt" style={{ color: pnlData.netProfit >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>{fmt(pnlData.netProfit)}</div>
            </div>
          </div>
          <div style={{ padding: '8px 0', borderTop: '0.5px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="bpbc-name">Carried over into business</div>
                <div className="bpbc-desc">{pct(pnlState.reinvestPct)} — agreed by all owners</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="bpbc-amt" style={{ color: 'var(--color-purple)', fontSize: '15px' }}>{fmt(pnlData.reinvestAmt)}</div>
              </div>
            </div>
            <div style={{ marginTop: '6px' }}>
              <input type="range" min="5" max="100" step="5" value={pnlState.reinvestPct} onChange={(e) => pnlU('reinvestPct', e.target.value)} style={{ width: '100%', accentColor: 'var(--color-purple)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '0.5px solid var(--color-border)' }}>
            <div>
              <div className="bpbc-name" style={{ fontWeight: '700' }}>Distributable to owners</div>
              <div className="bpbc-desc">{Math.round(100 - pnlState.reinvestPct)}% of net profit, split by ownership %</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bpbc-amt" style={{ color: 'var(--color-green)', fontSize: '15px', fontWeight: '700' }}>{fmt(pnlData.distributableProfit)}</div>
            </div>
          </div>
        </div>
        <div className="bp-ctrl">
          <div className="bp-ctrl-title">Future capital expenses</div>
          <div id="pnl-capex-list">
            {capExps.map(e => {
              const monthly = e.months > 0 ? e.amount / e.months : e.amount;
              return (
                <div key={e.id} style={{ paddingBottom: '8px', borderBottom: '0.5px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                    <input className="custom-exp-input" type="text" value={e.name} onChange={(e2) => updateCapEx(e.id, 'name', e2.target.value)} style={{ flex: 1 }} />
                    <button className="custom-exp-remove" onClick={() => removeCapEx(e.id)}>×</button>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div className="ac-label">Total cost</div>
                      <input type="range" min="5000" max="200000" step="5000" value={e.amount} onChange={(e2) => updateCapEx(e.id, 'amount', e2.target.value)} style={{ width: '100%' }} />
                      <div className="ac-val">{fmt(e.amount)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="ac-label">Finance over (months)</div>
                      <input type="range" min="1" max="60" step="1" value={e.months} onChange={(e2) => updateCapEx(e.id, 'months', e2.target.value)} style={{ width: '100%' }} />
                      <div className="ac-val">{e.months} mo → {fmt(monthly)}/mo</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ paddingTop: '8px' }}><button className="add-btn" style={{ marginBottom: '0' }} onClick={addCapEx}>+ Add capital expense</button></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '0.5px solid var(--color-border)', marginTop: '8px' }}>
            <div><div className="bpbc-name">Total capital required</div></div>
            <div style={{ textAlign: 'right' }}><div className="bpbc-amt" style={{ color: 'var(--color-red)', fontSize: '15px' }}>{fmt(pnlData.capExTotal)}</div></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '0.5px solid var(--color-border)' }}>
            <div><div className="bpbc-name">Covered by carryover?</div></div>
            <div style={{ textAlign: 'right' }}>
              <div className="bpbc-amt" style={{ fontSize: '13px', color: pnlData.capExTotal === 0 ? 'var(--color-text-secondary)' : pnlData.capExCovered ? 'var(--color-green)' : 'var(--color-red)' }}>
                {pnlData.capExTotal === 0 ? 'No capital expenses planned' : pnlData.capExCovered ? 'Fully covered by carryover (+' + fmt(pnlData.reinvestAmt - pnlData.capExTotal) + ' surplus)' : 'Shortfall of ' + fmt(pnlData.capExTotal - pnlData.reinvestAmt) + ' · ' + fmt(pnlData.capExMonthly) + '/mo if financed'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5-YEAR FUND BALANCE */}
      <div className="section-title">Carryover fund balance — 5-year projection</div>
      <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
        <table className="cut-table" style={{ minWidth: '600px' }}>
          <thead>
            <tr>
              <th></th>
              <th style={{ textAlign: 'right' }}>Year 1</th>
              <th style={{ textAlign: 'right' }}>Year 2</th>
              <th style={{ textAlign: 'right' }}>Year 3</th>
              <th style={{ textAlign: 'right' }}>Year 4</th>
              <th style={{ textAlign: 'right' }}>Year 5</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: '600' }}>{Math.round(pnlState.reinvestPct)}% carried over</td>
              {pnlData.fundBalances.map(b => <td key={b.year} style={{ textAlign: 'right' }}>{fmt(b.in)}</td>)}
            </tr>
            <tr>
              <td style={{ fontWeight: '600' }}>Capital spent</td>
              {pnlData.fundBalances.map(b => <td key={b.year} style={{ textAlign: 'right', color: 'var(--color-red)' }}>{b.out > 0 ? '-' + fmt(b.out) : '$0'}</td>)}
            </tr>
            <tr style={{ borderTop: '1.5px solid var(--color-border)' }}>
              <td style={{ fontWeight: '700' }}>Running balance</td>
              {pnlData.fundBalances.map(b => <td key={b.year} style={{ textAlign: 'right', fontWeight: '700', color: b.balance >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>{fmt(b.balance)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* METRICS */}
      <div className="bp-summary">
        <div className="metric"><div className="metric-label">Cost per deal</div><div className="metric-val">{fmt(pnlData.costPerDeal)}</div></div>
        <div className="metric"><div className="metric-label">Expired listing drag</div><div className="metric-val red">{fmt(pnlData.expiredCost)}</div></div>
        <div className="metric"><div className="metric-label">Break-even deals/agent/month</div><div className="metric-val" style={{ color: 'var(--color-purple)' }}>{pnlData.beDisplay}</div></div>
      </div>

      {/* FOOTNOTE */}
      <div className="footnote">All figures annual and pre-HST. Revenue reflects team's share of agent GCI based on weighted split structure plus owner's full GCI. Listing costs include expired listings that generate no revenue. Buyer deal costs cover admin, closing, and client events only. Admin bonus of $200/deal kicks in after 80 team deals per year. Owner brokerage is 5% of personal GCI to a $5,000 annual cap.</div>

      {/* EXPORT BUTTONS */}
      <div style={{ display: 'flex', gap: '10px', margin: '1.25rem 0 0.5rem', flexWrap: 'wrap' }}>
        <button onClick={exportPnlCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', background: 'var(--color-purple)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export CSV
        </button>
        <button onClick={printPnl} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', background: 'var(--color-green)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
          Print / Save PDF
        </button>
      </div>
        </div>
      )}

    </div>
  );
}





// SELLERS: LISTING SHOWINGS TRACKER
// ─────────────────────────────────────────────
function SellersSection() {
  const [sellerTab, setSellerTab] = useState("overview");
  const [expandedListing, setExpandedListing] = useState(null);
  const [expandedShowing, setExpandedShowing] = useState(null);
  const [expandedFollowUp, setExpandedFollowUp] = useState(null);

  const statusStyles = {
    confirmed: { color: "#059669", bg: "#ecfdf5", label: "Confirmed" },
    completed: { color: "#2563eb", bg: "#eff6ff", label: "Completed" },
    cancelled: { color: "#dc2626", bg: "#fef2f2", label: "Cancelled" },
    pending: { color: "#d97706", bg: "#fffbeb", label: "Pending" },
    requested: { color: "#7c3aed", bg: "#f5f3ff", label: "Requested" },
  };

  const feedbackStyles = {
    received: { color: "#059669", bg: "#ecfdf5", label: "Feedback In" },
    pending: { color: "#d97706", bg: "#fffbeb", label: "Chasing Feedback" },
    awaiting: { color: "#2563eb", bg: "#eff6ff", label: "Follow-Up Scheduled" },
    "n/a": { color: "#9ca3af", bg: "#f9fafb", label: "—" },
  };

  const interestStyles = {
    hot: { color: "#dc2626", label: "Very Interested" },
    warm: { color: "#f59e0b", label: "Warm — May Return" },
    cool: { color: "#6b7280", label: "Lukewarm" },
    cold: { color: "#3b82f6", label: "Not Interested" },
  };

  const tabs = [
    { id: "overview", label: "Listing Overview" },
    { id: "feedback", label: `My Feedback (${outstandingFeedback.length})` },
    { id: "followups", label: `Follow-Ups (${followUpQueue.length})` },
    { id: "automation", label: "Automation" },
  ];

  // Stats
  const totalShowings = showingIntelligence.filter(s => s.status !== "cancelled").length;
  const completedShowings = showingIntelligence.filter(s => s.status === "completed").length;
  const feedbackReceived = showingIntelligence.filter(s => s.feedbackStatus === "received").length;
  const pendingFollowUps = followUpQueue.filter(q => q.status !== "sent").length;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "#111827", margin: 0 }}>Listing Showings Intelligence</h3>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 3 }}>LIVE</span>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Powered by BrokerBay emails → AI parsing → Follow Up Boss</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
          <span style={{ fontSize: 10, color: "#6b7280" }}>Auto-monitoring Gmail</span>
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Active Listings", val: activeListings.length, color: "#8b5cf6", bg: "#f5f3ff" },
          { label: "Total Showings", val: totalShowings, color: "#2563eb", bg: "#eff6ff" },
          { label: "Feedback In", val: feedbackReceived, color: "#059669", bg: "#ecfdf5" },
          { label: "Follow-Ups Due", val: pendingFollowUps, color: "#e11d48", bg: "#fff1f2" },
        ].map(s => (
          <div key={s.label} style={{ padding: "12px 10px", borderRadius: 10, background: s.bg, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSellerTab(t.id)} style={{
            flex: 1, padding: "7px 10px", borderRadius: 8, border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: sellerTab === t.id ? "#fff" : "transparent", color: sellerTab === t.id ? "#111827" : "#6b7280",
            boxShadow: sellerTab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── LISTING OVERVIEW ── */}
      {sellerTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {activeListings.map(listing => {
            const listingShowings = showingIntelligence.filter(s => s.listingId === listing.id);
            const completed = listingShowings.filter(s => s.status === "completed").length;
            const upcoming = listingShowings.filter(s => ["confirmed", "requested"].includes(s.status)).length;
            const fbIn = listingShowings.filter(s => s.feedbackStatus === "received").length;
            const isExpanded = expandedListing === listing.id;

            return (
              <div key={listing.id} style={{ borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                <div onClick={() => setExpandedListing(isExpanded ? null : listing.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#fff", cursor: "pointer" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: "linear-gradient(135deg, #e11d48, #f43f5e)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <MapPin size={20} color="#fff" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{listing.address}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{listing.price} &middot; MLS# {listing.mls} &middot; {listing.daysOnMarket} DOM</div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Seller: {listing.sellerClient.name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ textAlign: "center", padding: "4px 10px" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#2563eb" }}>{completed}</div>
                      <div style={{ fontSize: 9, color: "#6b7280" }}>Shown</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "4px 10px" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>{fbIn}</div>
                      <div style={{ fontSize: 9, color: "#6b7280" }}>Feedback</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "4px 10px" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#d97706" }}>{upcoming}</div>
                      <div style={{ fontSize: 9, color: "#6b7280" }}>Upcoming</div>
                    </div>
                    <ChevronDown size={14} color="#9ca3af" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 16px 16px", background: "#fafafa", borderTop: "1px solid #f0f0f0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 8 }}>Showing History</div>
                    {listingShowings.map(s => {
                      const st = statusStyles[s.status] || { color: "#6b7280", bg: "#f3f4f6", label: s.status };
                      const fb = feedbackStyles[s.feedbackStatus] || { color: "#9ca3af", bg: "#f9fafb", label: "—" };
                      const isShowingExpanded = expandedShowing === s.id;
                      return (
                        <div key={s.id} style={{ marginBottom: 6 }}>
                          <div onClick={() => setExpandedShowing(isShowingExpanded ? null : s.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", cursor: "pointer" }}>
                            <div style={{ width: 3, height: 32, borderRadius: 2, background: st.color, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{s.date} &middot; {s.time} — {s.end}</div>
                              <div style={{ fontSize: 11, color: "#6b7280" }}>{s.buyerAgent}</div>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 4 }}>{st.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: fb.color, background: fb.bg, padding: "2px 8px", borderRadius: 4 }}>{fb.label}</span>
                            <ChevronDown size={11} color="#9ca3af" style={{ transform: isShowingExpanded ? "rotate(180deg)" : "none" }} />
                          </div>
                          {isShowingExpanded && (
                            <div style={{ margin: "4px 0 0 16px", padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                <div><span style={{ color: "#9ca3af" }}>Agent:</span> <span style={{ fontWeight: 600 }}>{s.buyerAgent}</span></div>
                                <div><span style={{ color: "#9ca3af" }}>Agent Phone:</span> <span style={{ fontWeight: 600 }}>{s.buyerAgentPhone || "—"}</span></div>
                                <div><span style={{ color: "#9ca3af" }}>Email Parsed:</span> <span style={{ fontWeight: 600 }}>{s.parsedAt}</span></div>
                                <div><span style={{ color: "#9ca3af" }}>Follow-Up Sent:</span> <span style={{ fontWeight: 600 }}>{s.followUpSentAt || "Scheduled"}</span></div>
                                {s.sellerNotified && <div><span style={{ color: "#9ca3af" }}>Seller Notified:</span> <span style={{ fontWeight: 600 }}>{s.sellerNotifiedAt}</span></div>}
                              </div>
                              {s.feedback && (
                                <div style={{ marginTop: 10, padding: 10, background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46" }}>Agent Feedback</span>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: interestStyles[s.feedback.interest].color }}>
                                      {interestStyles[s.feedback.interest].label}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
                                    {[1,2,3,4,5].map(star => (
                                      <Star key={star} size={12} fill={star <= s.feedback.rating ? "#f59e0b" : "none"} color={star <= s.feedback.rating ? "#f59e0b" : "#d1d5db"} />
                                    ))}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, fontStyle: "italic" }}>"{s.feedback.comment}"</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MY FEEDBACK — Outstanding feedback YOU need to give ── */}
      {sellerTab === "feedback" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 10, background: "linear-gradient(135deg, #fef2f2, #fff1f2)", border: "1px solid #fecdd3" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#9f1239" }}>Feedback You Owe</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
            </div>
            <div style={{ fontSize: 11, color: "#be123c", lineHeight: 1.5 }}>When you show a property as buyer agent, the listing agent requests feedback via BrokerBay. These are outstanding. Voice-to-text your thoughts and we'll submit through BrokerBay.</div>
          </div>

          {(() => {
            const submitted = getSubmittedFeedback();
            const pending = outstandingFeedback.filter(f => !submitted.includes(f.id));
            return pending.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>
                <CheckCircle2 size={28} style={{ margin: "0 auto 8px" }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>All caught up!</div>
                <div style={{ fontSize: 11 }}>No outstanding feedback requests.</div>
              </div>
            ) : (
              pending.map(fb => <FeedbackCard key={fb.id} fb={fb} />)
            );
          })()}

          {/* Recently completed feedback */}
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Completed Feedback</div>
          <div style={{ padding: 20, textAlign: "center", color: "#d1d5db", fontSize: 12 }}>No completed feedback yet — this section populates as you submit.</div>
        </div>
      )}

      {/* ── FOLLOW-UPS QUEUE ── */}
      {sellerTab === "followups" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 10, background: "linear-gradient(135deg, #fff1f2, #ffe4e6)", border: "1px solid #fecdd3" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#9f1239" }}>AI-Powered Follow-Up Queue</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#f59e0b", padding: "1px 5px", borderRadius: 3 }}>DRAFT</span>
            </div>
            <div style={{ fontSize: 11, color: "#be123c", lineHeight: 1.5 }}>These messages are AI-drafted for after each showing. Review, edit, and approve before sending.</div>
          </div>

          {followUpQueue.map(fq => {
            const isExpanded = expandedFollowUp === fq.id;
            const qColors = {
              scheduled: { color: "#2563eb", bg: "#eff6ff", label: "Scheduled" },
              pending: { color: "#d97706", bg: "#fffbeb", label: "Pending Approval" },
              sent: { color: "#059669", bg: "#ecfdf5", label: "Sent" },
              overdue: { color: "#dc2626", bg: "#fef2f2", label: "Overdue" },
            };
            const qc = qColors[fq.status];
            const typeLabels = { seller_sms: "SMS to Seller", agent_email: "Email to Agent", agent_followup: "Follow-Up to Agent" };

            return (
              <div key={fq.id} style={{ borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                <div onClick={() => setExpandedFollowUp(isExpanded ? null : fq.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: fq.status === "overdue" ? "#fef2f2" : "#fff", cursor: "pointer" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: fq.type.includes("sms") ? "#8b5cf6" + "15" : "#2563eb15", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {fq.type.includes("sms") ? <MessageCircle size={14} color="#8b5cf6" /> : <Send size={14} color="#2563eb" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{typeLabels[fq.type]} — {fq.recipient}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{fq.address} &middot; {fq.scheduledFor}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: qc.color, background: qc.bg, padding: "3px 8px", borderRadius: 4 }}>{qc.label}</span>
                  <ChevronDown size={12} color="#9ca3af" style={{ transform: isExpanded ? "rotate(180deg)" : "none" }} />
                </div>
                {isExpanded && (
                  <div style={{ padding: "12px 14px", background: "#f9fafb", borderTop: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>Message Preview:</div>
                    <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, color: "#374151", lineHeight: 1.6, fontStyle: "italic" }}>
                      {fq.message}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {fq.type.includes("sms") ? "Send via FUB" : "Send Email"}
                      </button>
                      <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                      <button style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Skip</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── AUTOMATION SETTINGS ── */}
      {sellerTab === "automation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* How the automation works */}
          <div style={{ padding: 16, borderRadius: 12, background: "linear-gradient(135deg, #1e1b4b, #312e81)", color: "#fff" }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Showing Intelligence Pipeline</div>
            <div style={{ fontSize: 11, color: "#c7d2fe", lineHeight: 1.6, marginBottom: 14 }}>AI monitors your Gmail for BrokerBay notifications, parses showing details, and triggers automated follow-ups through Follow Up Boss.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", icon: "📧", title: "Gmail Scan", desc: "Every 60s, check for new BrokerBay emails (requests, confirmations, cancellations)" },
                { step: "2", icon: "🤖", title: "AI Parsing", desc: "Extract property, time, agent, status from email content using Claude" },
                { step: "3", icon: "📋", title: "Dashboard Update", desc: "Showing appears in Agent HQ instantly" },
                { step: "4", icon: "⏰", title: "2-Hour Timer", desc: "After showing ends, wait 2 hours then trigger follow-up" },
                { step: "5", icon: "💬", title: "Seller SMS via FUB", desc: "Auto-text seller: 'Showing just finished, chasing feedback for you'" },
                { step: "6", icon: "✉️", title: "Agent Follow-Up", desc: "Email buyer's agent requesting feedback on the showing" },
                { step: "7", icon: "⭐", title: "Feedback Logged", desc: "When agent replies, AI parses feedback and updates the dashboard" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: "#c7d2fe" }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settings toggles */}
          <div style={{ padding: 14, borderRadius: 10, border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 12 }}>Automation Settings</div>
            {[
              { label: "Auto-send seller SMS after showings", desc: "Send via Follow Up Boss, 2 hours after showing ends", enabled: true },
              { label: "Auto-email buyer agents for feedback", desc: "Polite follow-up requesting feedback", enabled: true },
              { label: "Morning showing briefing", desc: "Include today's showings in your Morning Brief", enabled: true },
              { label: "Push notification on new showing requests", desc: "Get notified when a showing is requested on your listings", enabled: true },
              { label: "Auto-confirm showings", desc: "Automatically confirm all showing requests (use with caution)", enabled: false },
              { label: "Weekly seller report", desc: "Send sellers a summary of all showing activity and feedback", enabled: false },
            ].map((setting, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 5 ? "1px solid #f0f0f0" : "none" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{setting.label}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{setting.desc}</div>
                </div>
                <div style={{
                  width: 36, height: 20, borderRadius: 10, background: setting.enabled ? "#059669" : "#d1d5db",
                  position: "relative", cursor: "pointer", transition: "0.2s",
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute",
                    top: 2, left: setting.enabled ? 18 : 2, transition: "0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Connection status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { service: "Gmail", status: "Connected", color: "#059669", icon: "📧" },
              { service: "Follow Up Boss", status: "Connected", color: "#059669", icon: "💬" },
              { service: "BrokerBay", status: "Via Gmail", color: "#2563eb", icon: "🏠" },
            ].map(c => (
              <div key={c.service} style={{ padding: "12px 10px", borderRadius: 10, background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{c.service}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: c.color }}>{c.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function PlaceholderSection({ title, icon: Icon }) {
  return (
    <Card style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, color: "#d1d5db" }}>
      <Icon size={40} strokeWidth={1.2} />
      <div style={{ fontSize: 16, fontWeight: 600, color: "#9ca3af", marginTop: 14 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#d1d5db", marginTop: 4 }}>Content loads from your integrations</div>
    </Card>
  );
}

// ─────────────────────────────────────────────
// METRIC CARD
// ─────────────────────────────────────────────
function MetricCard({ card }) {
  const pct = Math.round((card.current / card.target) * 100);
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "16px 20px", flex: 1, minWidth: 180,
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid #f0f0f0", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: card.color }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500, marginBottom: 2 }}>{card.title}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{card.value}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
            {card.trend === "up" ? <ArrowUpRight size={12} color="#10b981" /> : <ArrowDownRight size={12} color="#ef4444" />}
            <span style={{ fontSize: 11, fontWeight: 600, color: card.trend === "up" ? "#10b981" : "#ef4444" }}>{card.change}</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>{card.period}</span>
          </div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ProgressRing pct={pct} color={card.color} />
          <span style={{ position: "absolute", fontSize: 11, fontWeight: 700, color: card.color }}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LISTING FORM — Pre-Listing Questionnaire & Checklist
// (Constants live in src/config/listing-form-options.js — imported at the
//  top of this file. Edit lists there, not here.)
// ─────────────────────────────────────────────

// defaultFormData, ChipSelect, FormField, FormSection are imported from
// ./components/form-helpers.jsx at the top of this file.

// inputStyle, selectStyle, textareaStyle, gridStyle moved to ./components/form-styles.js

// ─────────────────────────────────────────────
// APS PARSER — Parse OREA Form 100 PDFs
// ─────────────────────────────────────────────
function ApsParser() {
  const [deals, setDeals] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/aps/deals');
        const data = await res.json();
        if (data.ok) setDeals(data.deals || []);
      } catch {}
    })();
  }, []);

  const handleParse = async (file) => {
    if (!file) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      const res = await fetch('/api/aps/parse', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.ok) {
        setDeals(prev => [data.deal, ...prev]);
        setSelectedDeal(data.deal);
      } else {
        alert('Parse failed: ' + (data.error || 'unknown error'));
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
    setParsing(false);
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleParse(f); };
  const handleDelete = async (id) => {
    await fetch(`/api/aps/deals/${id}`, { method: 'DELETE' });
    setDeals(prev => prev.filter(d => d.id !== id));
    if (selectedDeal?.id === id) setSelectedDeal(null);
  };

  const priorityColors = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' };
  const condColors = { financing: '#8b5cf6', inspection: '#f59e0b', insurance: '#3b82f6', lawyer_review: '#6366f1', water_test: '#06b6d4', septic: '#84cc16', well: '#14b8a6', survey: '#ec4899', other: '#6b7280' };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: 0 }}>APS Parser</h2>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>Upload signed OREA Form 100 PDFs to extract deal details, conditions, and milestones</p>
        </div>
        <button onClick={() => fileRef.current?.click()} disabled={parsing} style={{ display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: parsing ? "wait" : "pointer", opacity: parsing ? 0.7 : 1 }}>
          {parsing ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Parsing...</> : <><Plus size={14} /> Upload APS</>}
        </button>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleParse(e.target.files[0]); e.target.value = ''; }} />
      </div>

      {/* Drop zone */}
      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
        style={{ border: `2px dashed ${dragOver ? '#2563eb' : '#d1d5db'}`, borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 20, background: dragOver ? '#eff6ff' : '#fafafa', transition: 'all 0.2s' }}>
        <FileText size={24} color={dragOver ? '#2563eb' : '#9ca3af'} style={{ margin: '0 auto 8px' }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: dragOver ? '#2563eb' : '#6b7280' }}>Drop APS PDF here</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Accepted offer, signed by both parties</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedDeal ? '320px 1fr' : '1fr', gap: 16 }}>
        {/* Deal list */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{deals.length} Parsed Deal{deals.length !== 1 ? 's' : ''}</div>
          {deals.length === 0 && <div style={{ fontSize: 12, color: '#9ca3af', padding: 16, textAlign: 'center' }}>No deals parsed yet. Upload an APS PDF to get started.</div>}
          {deals.map(d => (
            <div key={d.id} onClick={() => setSelectedDeal(d)} style={{ background: selectedDeal?.id === d.id ? '#eff6ff' : '#fff', border: `1px solid ${selectedDeal?.id === d.id ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{d.fields?.property?.address || d.filename || 'Unknown property'}</div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: d.status === 'firm' ? '#ecfdf5' : '#fef3c7', color: d.status === 'firm' ? '#059669' : '#d97706' }}>{d.status?.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {d.fields?.buyers?.join(' & ') || '?'} → {d.fields?.sellers?.join(' & ') || '?'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
                {d.fields?.purchasePrice?.amountCad && <span>${d.fields.purchasePrice.amountCad.toLocaleString()}</span>}
                {d.fields?.completionDate && <span>Close: {d.fields.completionDate}</span>}
                <span>Confidence: {Math.round((d.confidence || 0) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>

        {/* Deal detail */}
        {selectedDeal && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>{selectedDeal.fields?.property?.address || 'Property'}</h3>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{selectedDeal.filename} — parsed {new Date(selectedDeal.parsedAt).toLocaleDateString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: selectedDeal.status === 'firm' ? '#ecfdf5' : '#fef3c7', color: selectedDeal.status === 'firm' ? '#059669' : '#d97706' }}>{selectedDeal.status?.toUpperCase()}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280' }}>{selectedDeal.extractor?.toUpperCase()}</span>
                <button onClick={() => handleDelete(selectedDeal.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 2 }}><Trash2 size={14} /></button>
              </div>
            </div>

            {/* Key fields grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Purchase Price', value: selectedDeal.fields?.purchasePrice?.amountCad ? `$${selectedDeal.fields.purchasePrice.amountCad.toLocaleString()}` : '—' },
                { label: 'Deposit', value: selectedDeal.fields?.deposit?.amountCad ? `$${selectedDeal.fields.deposit.amountCad.toLocaleString()}` : '—' },
                { label: 'Closing Date', value: selectedDeal.fields?.completionDate || '—' },
                { label: 'Title Search', value: selectedDeal.fields?.titleSearchDate || '—' },
                { label: 'Agreement Date', value: selectedDeal.fields?.agreementDate || '—' },
                { label: 'Deposit Holder', value: selectedDeal.fields?.depositHolder || '—' },
                { label: 'Buyer(s)', value: (selectedDeal.fields?.buyers || []).join(', ') || '—' },
                { label: 'Seller(s)', value: (selectedDeal.fields?.sellers || []).join(', ') || '—' },
                { label: 'Form Type', value: selectedDeal.fields?.form || '—' },
              ].map((item, i) => (
                <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{item.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginTop: 2 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Conditions */}
            {selectedDeal.conditions?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Conditions ({selectedDeal.conditions.length})</div>
                {selectedDeal.conditions.map((c, i) => (
                  <div key={i} style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: 10, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: condColors[c.category] || '#6b7280', color: '#fff' }}>{c.category?.replace(/_/g, ' ').toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                      {c.businessDays && <span>{c.businessDays} business days</span>}
                      {c.waiverByIso && <span style={{ marginLeft: 8, fontWeight: 600, color: '#d97706' }}>Waive by: {c.waiverByIso}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Milestones timeline */}
            {selectedDeal.milestones?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Milestones Timeline</div>
                {selectedDeal.milestones.map((ms, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: priorityColors[ms.priority] || '#6b7280', flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{ms.title}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{ms.date} — {ms.priority}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Chattels & extras */}
            {(selectedDeal.fields?.chattelsIncluded || selectedDeal.fields?.fixturesExcluded) && (
              <div style={{ marginBottom: 20 }}>
                {selectedDeal.fields.chattelsIncluded && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Chattels Included</div>
                    <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{selectedDeal.fields.chattelsIncluded}</div>
                  </div>
                )}
                {selectedDeal.fields.fixturesExcluded && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Fixtures Excluded</div>
                    <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{selectedDeal.fields.fixturesExcluded}</div>
                  </div>
                )}
              </div>
            )}

            {/* Lawyers & emails */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {selectedDeal.fields?.lawyers?.buyer && (
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Buyer's Lawyer</div>
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{selectedDeal.fields.lawyers.buyer}</div>
                </div>
              )}
              {selectedDeal.fields?.lawyers?.seller && (
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Seller's Lawyer</div>
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{selectedDeal.fields.lawyers.seller}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ListingForm moved to ./components/ListingForm.jsx (extracted 2026-04-24)

// ─────────────────────────────────────────────
// CLAUDE STUCK TICKER
// ─────────────────────────────────────────────
function ClaudeStuckTicker() {
  const eaData = useContext(EaContext);
  const [expandedId, setExpandedId] = useState(null);
  const [resolving, setResolving] = useState(null);

  if (!eaData || !eaData.stuck) return null;
  const { questions, resolveQuestion, dismissQuestion } = eaData.stuck;
  if (!questions || questions.length === 0) return null;

  const priorityColors = { p0: '#dc2626', p1: '#f59e0b', p2: '#6b7280' };
  const priorityLabels = { p0: 'URGENT', p1: 'NEEDS INPUT', p2: 'QUESTION' };

  const handleResolve = async (id, label) => {
    setResolving(id);
    await resolveQuestion(id, label);
    setResolving(null);
    setExpandedId(null);
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef3c7, #fffbeb)',
      border: '1px solid #f59e0b',
      borderRadius: 12,
      padding: '12px 16px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: questions.length > 0 ? 10 : 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 2s infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Claude needs your answer ({questions.length})
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {questions.map((q) => {
          const isExpanded = expandedId === q.id;
          const pColor = priorityColors[q.priority] || '#6b7280';
          const pLabel = priorityLabels[q.priority] || 'QUESTION';

          return (
            <div key={q.id} style={{
              background: '#fff',
              borderRadius: 8,
              border: `1px solid ${isExpanded ? '#f59e0b' : '#e5e7eb'}`,
              overflow: 'hidden',
              transition: 'border-color 0.2s',
            }}>
              {/* Question header */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  cursor: 'pointer', background: isExpanded ? '#fffbeb' : 'transparent',
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 700, color: '#fff', background: pColor,
                  borderRadius: 4, padding: '2px 6px', flexShrink: 0,
                }}>{pLabel}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 }}>{q.summary}</span>
                <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
                  {q.workflow !== 'general' ? q.workflow : ''}
                </span>
                <ChevronDown size={14} color="#9ca3af" style={{
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 0.2s',
                }} />
              </div>

              {/* Expanded options */}
              {isExpanded && (
                <div style={{ padding: '0 12px 12px', borderTop: '1px solid #f3f4f6' }}>
                  {q.context && (
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0', lineHeight: 1.5 }}>{q.context}</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {(q.options || []).map((opt, i) => (
                      <button
                        key={i}
                        disabled={resolving === q.id}
                        onClick={() => handleResolve(q.id, opt.label)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                          padding: '8px 12px', borderRadius: 6,
                          border: '1px solid #e5e7eb', background: '#f9fafb',
                          cursor: resolving === q.id ? 'wait' : 'pointer',
                          opacity: resolving === q.id ? 0.6 : 1,
                          transition: 'all 0.15s',
                          textAlign: 'left',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#c8a96e22'; e.currentTarget.style.borderColor = '#c8a96e'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{opt.label}</span>
                        {opt.description && (
                          <span style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{opt.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => dismissQuestion(q.id)}
                    style={{
                      marginTop: 8, fontSize: 11, color: '#9ca3af', background: 'none',
                      border: 'none', cursor: 'pointer', padding: '4px 0',
                    }}
                  >
                    Skip / not relevant
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SECTION ROUTER
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// QUICK LINKS PANEL — Self-healing, server-managed URL registry
// ─────────────────────────────────────────────
function QuickLinksPanel() {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);

  const fetchLinks = () => {
    fetch('/api/quicklinks').then(r => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => { fetchLinks(); }, []);

  const runHealthCheck = async () => {
    setChecking(true);
    try {
      await fetch('/api/quicklinks/health-check', { method: 'POST' });
      await new Promise(r => setTimeout(r, 1500));
      fetchLinks();
    } catch {} finally { setChecking(false); }
  };

  const statusDot = (s) => {
    const color = s === 'alive' ? '#10b981' : s === 'dead' ? '#ef4444' : s === 'error' ? '#f59e0b' : '#d1d5db';
    return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
  };

  if (!data) return null;

  const groupOrder = ['Calendar', 'Email EA', 'Gmail', 'Follow Up Boss', 'Team Jordan Import', 'Listing Form', 'System', 'Custom'];
  const sortedGroups = Object.entries(data.groups || {}).sort((a, b) => {
    const ai = groupOrder.indexOf(a[0]);
    const bi = groupOrder.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <ExternalLink size={16} color="#c8a96e" />
        <span style={{ fontSize: 14, fontWeight: 700, color: "#111827", flex: 1 }}>Quick Links</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{data.totalLinks} links</span>
        <button onClick={runHealthCheck} disabled={checking} style={{ fontSize: 10, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
          {checking ? 'Checking...' : 'Health Check'}
        </button>
      </div>
      {data.health?.lastCheck && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 12 }}>
          Last checked: {new Date(data.health.lastCheck).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {data.health.deadRemoved > 0 && <span style={{ color: "#ef4444", marginLeft: 6 }}>{data.health.deadRemoved} dead links removed</span>}
        </div>
      )}

      {sortedGroups.map(([groupName, links]) => (
        <div key={groupName} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{groupName}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {links.map(link => (
              <a key={link.id} href={`https://hq.jonathanwallace.ca${link.url}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f9fafb", textDecoration: "none", fontSize: 12, transition: "background 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                onMouseLeave={e => e.currentTarget.style.background = '#f9fafb'}>
                {statusDot(link.status)}
                <span style={{ fontWeight: 600, color: link.status === 'dead' ? '#9ca3af' : '#2563eb', minWidth: 140 }}>{link.label}</span>
                <span style={{ color: "#9ca3af", fontSize: 11, flex: 1 }}>{link.desc}</span>
                <ExternalLink size={10} color="#9ca3af" />
              </a>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// LIFETIME STATS — GCI, Deals, Commission by Year
// ─────────────────────────────────────────────
function LifetimeStats() {
  const [expandedYear, setExpandedYear] = useState(null);
  const [filter, setFilter] = useState('all');

  const yearData = {
    2025: {
      brokerage: 'Faris Team + KW Co-Elevation',
      ends: 33,
      totalGCI: 171227.00,
      totalHST: 21206.50,
      deals: [
        { date: '2025-01-07', address: '297 King Street', commission: 2212.92, hst: 287.68, net: 2500.60, brokerage: 'Faris Team' },
        { date: '2025-01-10', address: '122 Hurontario Street', commission: 13466.67, hst: 1750.67, net: 15217.34, brokerage: 'Faris Team' },
        { date: '2025-02-14', address: '380 Corrievale Road', commission: 3402.92, hst: 442.38, net: 3845.30, brokerage: 'Faris Team' },
        { date: '2025-02-14', address: '525 Midland Point Road 41', commission: 1258.33, hst: 163.58, net: 1421.91, brokerage: 'Faris Team' },
        { date: '2025-05-16', address: 'Lot 45 Tiny Beaches Road N', commission: 2040.00, hst: 265.20, net: 2305.20, brokerage: 'Faris Team' },
        { date: '2025-05-21', address: '78 Stans Circle', commission: 1062.00, hst: 138.06, net: 1200.06, brokerage: 'Faris Team' },
        { date: '2025-05-30', address: '90 Burke Street 14', commission: 7099.20, hst: 922.90, net: 7276.44, brokerage: 'Faris Team' },
        { date: '2025-06-03', address: '422 Young Avenue', commission: 834.00, hst: 108.42, net: 942.42, brokerage: 'Faris Team' },
        { date: '2025-06-06', address: '179 Fifth Street', commission: 6420.00, hst: 834.60, net: 7254.60, brokerage: 'Faris Team' },
        { date: '2025-06-10', address: '40 Trott Boulevard 701', commission: 7219.17, hst: 938.49, net: 8157.66, brokerage: 'Faris Team' },
        { date: '2025-06-24', address: '63 Julia Cres', commission: 3217.08, hst: 418.22, net: 3635.30, brokerage: 'Faris Team' },
        { date: '2025-06-27', address: '20 Domar Road', commission: 3204.00, hst: 416.52, net: 3620.52, brokerage: 'Faris Team' },
        { date: '2025-07-15', address: '61 Robert Street W', commission: 1715.42, hst: 223.00, net: 1938.42, brokerage: 'Faris Team' },
        { date: '2025-08-08', address: '2752 Old Fort Road', commission: 7146.00, hst: 928.98, net: 8074.98, brokerage: 'Faris Team' },
        { date: '2025-08-08', address: '954 Hugel Ave', commission: 6273.00, hst: 815.49, net: 7088.49, brokerage: 'Faris Team' },
        { date: '2025-08-26', address: '114 Bay Street', commission: 7470.00, hst: 971.10, net: 8441.10, brokerage: 'Faris Team' },
        { date: '2025-09-05', address: '493 7th Avenue', commission: 7164.00, hst: 931.32, net: 8095.32, brokerage: 'Faris Team' },
        { date: '2025-09-09', address: '50 Mulligan Lane 110', commission: 7873.33, hst: 1023.53, net: 8896.86, brokerage: 'Faris Team' },
        { date: '2025-09-12', address: '15765 Highway 12', commission: 2400.00, hst: 312.00, net: 2712.00, brokerage: 'Faris Team' },
        { date: '2025-09-12', address: '3358 Muskoka Street', commission: 3480.00, hst: 452.40, net: 3932.40, brokerage: 'Faris Team' },
        { date: '2025-10-07', address: '7466 Line 11', commission: 7092.00, hst: 921.96, net: 8013.96, brokerage: 'Faris Team' },
        { date: '2025-10-17', address: '206 Bonneville Road', commission: 7020.00, hst: 912.60, net: 7932.60, brokerage: 'Faris Team' },
        { date: '2025-10-24', address: '27 Julia Crescent', commission: 1296.00, hst: 168.48, net: 1464.48, brokerage: 'Faris Team' },
        { date: '2025-11-04', address: '1321 Tiny Beaches Road', commission: 2580.00, hst: 335.40, net: 2915.40, brokerage: 'Faris Team' },
        { date: '2025-11-14', address: 'Lot 17 Faesulae Road', commission: 1980.00, hst: 257.40, net: 2237.40, brokerage: 'Faris Team' },
        { date: '2025-11-17', address: '7308 Main St', commission: 25000.00, hst: 2405.00, net: 18500.00, brokerage: 'KW Co-Elevation' },
        { date: '2025-11-17', address: '7308 Main St (2nd)', commission: 10000.00, hst: 1092.00, net: 8400.00, brokerage: 'KW Co-Elevation' },
        { date: '2025-11-18', address: '369 Manly Street', commission: 4244.40, hst: 551.77, net: 4796.17, brokerage: 'Faris Team' },
        { date: '2025-12-02', address: '405 Bay Street', commission: 504.00, hst: 65.52, net: 569.52, brokerage: 'Faris Team' },
        { date: '2025-12-02', address: '612 Bay Street Lower', commission: 792.00, hst: 102.96, net: 894.96, brokerage: 'Faris Team' },
        { date: '2025-12-05', address: '707 9th Ave', commission: 4768.92, hst: 619.96, net: 5388.88, brokerage: 'Faris Team' },
        { date: '2025-12-16', address: '8 Glen Forest Trail', commission: 6150.00, hst: 799.50, net: 6949.50, brokerage: 'Faris Team' },
        { date: '2025-12-30', address: '1721 Newton Street', commission: 4841.64, hst: 629.41, net: 5471.05, brokerage: 'Faris Team' },
      ],
    },
    2024: {
      brokerage: 'KW Co-Elevation',
      ends: 35,
      totalGCI: 208081.62,
      totalHST: 25682.38,
      deals: [
        { date: '2024-01-23', address: '382 Mary St', commission: 2625.00, hst: 331.50, net: 2881.50 },
        { date: '2024-01-25', address: 'Lot 52 Silver Birch Dr', commission: 17812.50, hst: 2296.13, net: 19958.63 },
        { date: '2024-01-26', address: '84 Nicole Blvd', commission: 9687.50, hst: 1249.63, net: 10862.13 },
        { date: '2024-02-16', address: '472 William St Upper', commission: 537.50, hst: 51.71, net: 449.46 },
        { date: '2024-02-29', address: '3536 Shady Crt', commission: 16125.00, hst: 1551.22, net: 13483.72 },
        { date: '2024-03-25', address: '159 Church St 5', commission: 1921.87, hst: 184.88, net: 1607.07 },
        { date: '2024-05-30', address: 'Lot 27 Poplar Dr', commission: 2362.50, hst: 227.27, net: 1975.52 },
        { date: '2024-06-17', address: '255 Robins Point Rd', commission: 4416.00, hst: 424.82, net: 3692.66 },
        { date: '2024-06-27', address: '159 Church St 8', commission: 4625.00, hst: 444.92, net: 3867.42 },
        { date: '2024-07-04', address: 'Lot 26 Grant Ave', commission: 3687.50, hst: 450.30, net: 3914.12 },
        { date: '2024-07-05', address: '97 Anderson Cres', commission: 18750.00, hst: 2300.41, net: 19995.93 },
        { date: '2024-07-08', address: '78 Hurst Dr', commission: 10968.75, hst: 1416.19, net: 12309.94 },
        { date: '2024-07-15', address: '2135 Ferguson St', commission: 8087.50, hst: 1041.63, net: 9054.13 },
        { date: '2024-07-17', address: '1445 Margaret Cres', commission: 13125.00, hst: 1696.50, net: 14746.50 },
        { date: '2024-07-28', address: '13 Robert St W', commission: 13875.00, hst: 1794.00, net: 15594.00 },
        { date: '2024-08-07', address: '481 Trillium St', commission: 4562.50, hst: 583.38, net: 5070.88 },
        { date: '2024-08-08', address: '678 Simcoe Ave', commission: 6873.75, hst: 883.84, net: 7682.59 },
        { date: '2024-10-02', address: '98 Savannah Cres', commission: 10562.50, hst: 1363.38, net: 11850.88 },
        { date: '2024-10-02', address: '201 Rustic Rd', commission: 17500.00, hst: 2265.25, net: 19690.25 },
        { date: '2024-10-04', address: '2774 Old Fort Rd', commission: 8312.50, hst: 1070.88, net: 9308.38 },
        { date: '2024-10-21', address: '50 Mulligan Ln 110', commission: 4450.00, hst: 568.75, net: 4943.75 },
        { date: '2024-10-30', address: '249 King St Upper', commission: 475.00, hst: 52.00, net: 452.00 },
        { date: '2024-11-04', address: '447 William St', commission: 3531.25, hst: 455.81, net: 3962.06 },
        { date: '2024-11-12', address: '11 Richelieu St', commission: 9325.00, hst: 1202.50, net: 10452.50 },
        { date: '2024-11-15', address: '35 Farlain Lake Rd E', commission: 2195.00, hst: 275.60, net: 2395.60 },
        { date: '2024-11-26', address: '5418 Penetanguishene Rd', commission: 7250.00, hst: 932.75, net: 8107.75 },
        { date: '2024-12-12', address: '352 Curry Rd', commission: 4437.50, hst: 567.13, net: 4929.63 },
      ],
    },
    2022: {
      brokerage: 'KW Experience + KW Co-Elevation',
      ends: 44,
      totalGCI: 309008.24,
      totalHST: 38584.26,
      deals: [
        { date: '2022-01-19', address: '121 Robins Point Road', commission: 625.00, hst: 77.19, net: 593.75 },
        { date: '2022-03-02', address: '176 Letitia Street', commission: 3500.00, hst: 336.70, net: 2590.00 },
        { date: '2022-03-14', address: '329 Thunder Beach Road', commission: 5562.50, hst: 535.11, net: 4116.25 },
        { date: '2022-03-16', address: '614 Taylor Drive', commission: 1875.00, hst: 180.37, net: 1387.50 },
        { date: '2022-03-18', address: '751 Stone Street', commission: 20187.50, hst: 2160.30, net: 16617.67 },
        { date: '2022-03-18', address: '12 Finley Drive', commission: 7269.60, hst: 699.34, net: 5379.50 },
        { date: '2022-03-21', address: '19 Pine Street', commission: 10078.13, hst: 1267.90, net: 9753.06 },
        { date: '2022-03-21', address: '374 Borden Street', commission: 7750.00, hst: 938.92, net: 7222.50 },
        { date: '2022-03-21', address: '340 Borden Street', commission: 8500.00, hst: 1096.87, net: 8437.50 },
        { date: '2022-03-30', address: '711 Yonge Street', commission: 2464.90, hst: 308.25, net: 2371.15 },
        { date: '2022-03-31', address: '54 Timcourt Drive', commission: 9393.75, hst: 1213.06, net: 9331.25 },
        { date: '2022-04-06', address: '414 First Avenue', commission: 799.30, hst: 99.85, net: 768.05 },
        { date: '2022-04-08', address: '296 Colborne Street', commission: 5030.00, hst: 645.77, net: 4967.50 },
        { date: '2022-04-08', address: '514 Johnson Street', commission: 10375.00, hst: 1340.62, net: 10312.50 },
        { date: '2022-04-11', address: '346 Lescaut Road', commission: 7812.50, hst: 1007.50, net: 7750.00 },
        { date: '2022-04-22', address: '21 Red Cedar Lane', commission: 14250.00, hst: 1844.37, net: 14187.50 },
        { date: '2022-05-06', address: '565 Simcoe Avenue', commission: 4218.75, hst: 544.38, net: 4187.50 },
        { date: '2022-05-20', address: '702 4th Avenue', commission: 3681.25, hst: 474.50, net: 3650.00 },
        { date: '2022-05-27', address: '338 Tiny Beaches Road N', commission: 13703.49, hst: 1773.32, net: 13640.99 },
        { date: '2022-05-27', address: '17 Gray Street', commission: 3671.88, hst: 473.28, net: 3640.63 },
        { date: '2022-06-01', address: '222 Queen Street', commission: 16250.00, hst: 2104.37, net: 16187.50 },
        { date: '2022-06-22', address: '485 Bayport Boulevard', commission: 19375.00, hst: 2510.62, net: 19312.50 },
        { date: '2022-06-24', address: '358 Mary Street', commission: 3625.00, hst: 467.19, net: 3593.75 },
        { date: '2022-07-06', address: '1255 Fuller Avenue', commission: 27587.50, hst: 3570.12, net: 27462.50 },
        { date: '2022-07-13', address: '246 Spruce Street', commission: 4185.00, hst: 539.99, net: 4153.75 },
        { date: '2022-07-29', address: '756 Hugel Ave', commission: 6562.50, hst: 843.38, net: 6487.50 },
        { date: '2022-08-09', address: '26 Duquette Crt', commission: 3046.88, hst: 386.34, net: 2971.88 },
        { date: '2022-08-12', address: 'Lot 53 Pinecone Ave', commission: 1562.50, hst: 193.38, net: 1487.50 },
        { date: '2022-08-18', address: '65 Lackie Crescent', commission: 5625.00, hst: 721.50, net: 5550.00 },
        { date: '2022-08-19', address: '4 Anne St', commission: 7187.50, hst: 924.63, net: 7112.50 },
        { date: '2022-08-26', address: '101 Thompsons Road F306', commission: 4655.00, hst: 597.02, net: 4592.50 },
        { date: '2022-08-31', address: '280 Aberdeen Blvd 107', commission: 4912.50, hst: 619.13, net: 4762.50 },
        { date: '2022-09-06', address: '4961 5th Side Rd', commission: 3332.81, hst: 423.52, net: 3257.81 },
        { date: '2022-09-22', address: '311 Concession 14 W', commission: 6900.00, hst: 887.25, net: 6825.00 },
        { date: '2022-09-27', address: '49 James St', commission: 4640.62, hst: 593.53, net: 4565.62 },
        { date: '2022-10-06', address: '1655 Dunns Line', commission: 2437.50, hst: 307.13, net: 2362.50 },
        { date: '2022-10-07', address: '115 Palmer St', commission: 2968.75, hst: 376.19, net: 2893.75 },
        { date: '2022-11-25', address: '296 Colborne St', commission: 8250.00, hst: 1053.00, net: 8100.00 },
        { date: '2022-12-02', address: '7 Riverwalk Dr', commission: 1627.50, hst: 201.83, net: 1552.50 },
        { date: '2022-12-07', address: '26 Beatrice Dr', commission: 700.00, hst: 81.25, net: 625.00 },
        { date: '2022-12-16', address: '253 Lescaut Rd', commission: 7750.00, hst: 997.75, net: 7675.00 },
        { date: '2022-12-22', address: '420 Lakewood Dr', commission: 12812.50, hst: 1655.88, net: 12737.50 },
        { date: '2022-12-22', address: '8 Evans St', commission: 6703.13, hst: 861.66, net: 6628.13 },
      ],
    },
    2019: {
      brokerage: 'KW Experience',
      ends: 51,
      totalGCI: 118600.64,
      totalHST: 13678.13,
      deals: [
        { date: '2019-05-01', address: '11 Maria Street', commission: 3687.50, hst: 306.81, net: 2360.00 },
        { date: '2019-05-03', address: 'Lt117 Lindale Avenue', commission: 343.75, hst: 28.60, net: 219.99 },
        { date: '2019-05-30', address: '12324 County Road 16', commission: 4062.50, hst: 338.00, net: 2600.00 },
        { date: '2019-05-30', address: '135 Lumber Road', commission: 4900.00, hst: 407.68, net: 3136.00 },
        { date: '2019-06-10', address: '700 Tiny Beaches Road', commission: 125.00, hst: 8.77, net: 67.50 },
        { date: '2019-06-21', address: '30 Oriole Street', commission: 335.83, hst: 27.94, net: 214.93 },
        { date: '2019-06-26', address: '30, 31, 34 Silver Birch Crescent', commission: 281.25, hst: 23.40, net: 179.99 },
        { date: '2019-06-27', address: '606 Midland Point Road', commission: 1100.00, hst: 91.52, net: 704.00 },
        { date: '2019-07-12', address: '1 Glenview Avenue', commission: 1230.00, hst: 102.34, net: 787.20 },
        { date: '2019-07-15', address: '24 George Street', commission: 4812.50, hst: 400.40, net: 3080.00 },
        { date: '2019-07-24', address: '1390 Hallen Place', commission: 1007.81, hst: 83.86, net: 645.00 },
        { date: '2019-07-26', address: '200 Margaret Street', commission: 6160.00, hst: 512.52, net: 3942.40 },
        { date: '2019-07-26', address: '874 Montreal Street', commission: 2226.29, hst: 203.16, net: 1562.82 },
        { date: '2019-07-31', address: '32 Giants Tomb Island', commission: 1350.00, hst: 162.36, net: 1249.00 },
        { date: '2019-08-08', address: '344 First Street', commission: 312.50, hst: 26.00, net: 199.98 },
        { date: '2019-08-12', address: '783 Midland Point Road', commission: 1625.00, hst: 197.27, net: 1517.50 },
        { date: '2019-08-12', address: '1942 Tiny Beaches Road N', commission: 6397.50, hst: 773.97, net: 5953.64 },
        { date: '2019-08-14', address: '47 Beck Bouelvard', commission: 1625.00, hst: 197.27, net: 1517.50 },
        { date: '2019-08-14', address: '6 Copeland Street', commission: 4127.58, hst: 497.90, net: 3829.93 },
        { date: '2019-08-19', address: '5 Grandview Road', commission: 375.00, hst: 32.84, net: 252.50 },
        { date: '2019-08-21', address: '30 Duffy Drive', commission: 1337.50, hst: 160.20, net: 1232.25 },
        { date: '2019-08-28', address: '699 Aberdeen Boulevard 907', commission: 3950.00, hst: 486.90, net: 3745.38 },
        { date: '2019-08-29', address: '607 Norman Crescent', commission: 2625.00, hst: 338.00, net: 2600.00 },
        { date: '2019-08-29', address: '177 Stocco Circle', commission: 2531.25, hst: 319.32, net: 2456.25 },
        { date: '2019-09-05', address: '2039 Tiny Beaches Road S', commission: 912.50, hst: 117.33, net: 902.50 },
        { date: '2019-09-09', address: '473 Manly Street', commission: 637.50, hst: 81.58, net: 627.50 },
        { date: '2019-09-20', address: '518 First Avenue', commission: 421.88, hst: 45.09, net: 346.88 },
        { date: '2019-09-25', address: '333 Lafontaine Road 306', commission: 1248.75, hst: 155.84, net: 1198.75 },
        { date: '2019-09-27', address: '1720 Tay Point Road', commission: 3075.00, hst: 391.96, net: 3015.00 },
        { date: '2019-09-30', address: '10 Bonaventure Place', commission: 5475.00, hst: 705.25, net: 5425.00 },
        { date: '2019-09-30', address: '100b Hughes Lane', commission: 1062.50, hst: 131.63, net: 1012.50 },
        { date: '2019-10-03', address: '548 5th Avenue', commission: 345.00, hst: 37.06, net: 285.00 },
        { date: '2019-10-03', address: '289 Gervais Street', commission: 850.00, hst: 109.20, net: 840.00 },
        { date: '2019-10-03', address: '116 Mill Street E', commission: 7062.50, hst: 911.63, net: 7012.50 },
        { date: '2019-10-09', address: 'Lot 34 Macavalley Road', commission: 555.00, hst: 70.85, net: 545.00 },
        { date: '2019-10-15', address: '994 Booth Avenue', commission: 1020.00, hst: 131.30, net: 1010.00 },
        { date: '2019-10-17', address: 'Pin 584370045', commission: 125.00, hst: 13.00, net: 100.00 },
        { date: '2019-10-21', address: '301 Andrew Street', commission: 4650.00, hst: 598.00, net: 4600.00 },
        { date: '2019-10-23', address: '92 Church Street', commission: 1137.50, hst: 146.58, net: 1127.50 },
        { date: '2019-10-23', address: '1225 Vinden Street', commission: 362.50, hst: 45.83, net: 352.50 },
        { date: '2019-10-31', address: '385 Hugel Avenue', commission: 3550.00, hst: 455.00, net: 3500.00 },
        { date: '2019-11-08', address: '72 New York', commission: 4812.50, hst: 619.13, net: 4762.50 },
        { date: '2019-11-20', address: '40 Concession 8 West', commission: 2437.50, hst: 313.63, net: 2412.50 },
        { date: '2019-11-22', address: '27 Main Street', commission: 2000.00, hst: 256.75, net: 1975.00 },
        { date: '2019-11-26', address: '39 Mourning Dove Trail', commission: 8156.25, hst: 1053.81, net: 8106.25 },
        { date: '2019-11-29', address: '27 Anderson Place', commission: 1387.50, hst: 179.08, net: 1377.50 },
        { date: '2019-11-30', address: '37 Crown Court', commission: 875.00, hst: 112.45, net: 865.00 },
        { date: '2019-12-06', address: '10 Grosvenor Drive', commission: 3150.00, hst: 403.00, net: 3100.00 },
        { date: '2019-12-06', address: '41 Elm', commission: 2006.25, hst: 257.56, net: 1981.25 },
        { date: '2019-12-18', address: '42 Berts Road', commission: 2475.00, hst: 315.25, net: 2425.00 },
        { date: '2019-12-27', address: '1203 Walkers Point Road', commission: 2281.25, hst: 293.31, net: 2256.25 },
      ],
    },
    2020: {
      brokerage: 'KW Experience',
      ends: 82,
      totalGCI: 253751.48,
      totalHST: 31494.09,
      deals: [
        { date: '2020-01-13', address: '235 King Street', commission: 125.00, hst: 13.00, net: 100.00, brokerage: 'KW Experience' },
        { date: '2020-01-17', address: '355 Glenbrook Drive', commission: 7875.00, hst: 1017.25, net: 7825.00, brokerage: 'KW Experience' },
        { date: '2020-02-10', address: '31 Silver Birch Crescent', commission: 125.00, hst: 10.39, net: 80.00, brokerage: 'KW Experience' },
        { date: '2020-02-12', address: '260 Davis Drive #102', commission: 4550.00, hst: 378.56, net: 2912.00, brokerage: 'KW Experience' },
        { date: '2020-02-12', address: '1 Dufferin Street', commission: 5212.50, hst: 433.68, net: 3336.00, brokerage: 'KW Experience' },
        { date: '2020-02-14', address: '599 Walpole Crescent', commission: 7150.00, hst: 594.88, net: 4576.00, brokerage: 'KW Experience' },
        { date: '2020-02-28', address: '848 Midland Point Road', commission: 8187.50, hst: 884.98, net: 6807.50, brokerage: 'KW Experience' },
        { date: '2020-03-04', address: '128 Wawinet Street', commission: 4471.87, hst: 541.58, net: 4166.06, brokerage: 'KW Experience' },
        { date: '2020-03-09', address: '957 Dominion Avenue', commission: 987.50, hst: 119.38, net: 918.25, brokerage: 'KW Experience' },
        { date: '2020-04-03', address: '12 & 14 Thunderbay Lane', commission: 1062.50, hst: 128.54, net: 988.75, brokerage: 'KW Experience' },
        { date: '2020-04-21', address: '252 Woodlands Avenue', commission: 500.00, hst: 54.60, net: 420.00, brokerage: 'KW Experience' },
        { date: '2020-04-21', address: '38 Howard Park Avenue #527', commission: 50.00, hst: 0.00, net: 0.00, brokerage: 'KW Experience' },
        { date: '2020-04-28', address: '1089 Whitney Crescent', commission: 5375.00, hst: 650.32, net: 5002.50, brokerage: 'KW Experience' },
        { date: '2020-04-30', address: 'Lot 13 Staglir Drive', commission: 562.50, hst: 65.49, net: 503.75, brokerage: 'KW Experience' },
        { date: '2020-05-08', address: '245 Moonstone Road East', commission: 1242.50, hst: 150.54, net: 1157.95, brokerage: 'KW Experience' },
        { date: '2020-05-15', address: '5 Meadows Avenue', commission: 2500.00, hst: 302.25, net: 2325.00, brokerage: 'KW Experience' },
        { date: '2020-05-15', address: '4 Flora Court', commission: 2315.00, hst: 277.69, net: 2136.10, brokerage: 'KW Experience' },
        { date: '2020-05-19', address: '5411 Elliott Side Road 3', commission: 2937.50, hst: 352.47, net: 2711.25, brokerage: 'KW Experience' },
        { date: '2020-05-26', address: '47 Hill Top Drive', commission: 4562.50, hst: 565.02, net: 4346.26, brokerage: 'KW Experience' },
        { date: '2020-06-09', address: '47 Springhome Road', commission: 1612.50, hst: 208.33, net: 1602.50, brokerage: 'KW Experience' },
        { date: '2020-06-19', address: '4176 Neilsen Road', commission: 2312.25, hst: 299.29, net: 2302.25, brokerage: 'KW Experience' },
        { date: '2020-06-19', address: '108 Mitchells Beach Road', commission: 1650.00, hst: 213.20, net: 1640.00, brokerage: 'KW Experience' },
        { date: '2020-06-23', address: '2351 Mcdonald Road', commission: 2304.00, hst: 298.22, net: 2294.00, brokerage: 'KW Experience' },
        { date: '2020-06-26', address: '564 Second Avenue', commission: 118.75, hst: 12.19, net: 93.75, brokerage: 'KW Experience' },
        { date: '2020-06-26', address: '81 Marshall Road', commission: 650.00, hst: 83.20, net: 640.00, brokerage: 'KW Experience' },
        { date: '2020-07-07', address: '1050 Whitney Crescent', commission: 6148.50, hst: 791.51, net: 6088.50, brokerage: 'KW Experience' },
        { date: '2020-07-10', address: '47 50th Street', commission: 3375.00, hst: 432.25, net: 3325.00, brokerage: 'KW Experience' },
        { date: '2020-07-10', address: '123 Centre Beach Road', commission: 4575.00, hst: 586.96, net: 4515.00, brokerage: 'KW Experience' },
        { date: '2020-07-14', address: '36 & 37 Methodist Island', commission: 512.50, hst: 53.62, net: 412.50, brokerage: 'KW Experience' },
        { date: '2020-07-17', address: '156 Southwinds Crescent', commission: 4000.00, hst: 513.50, net: 3950.00, brokerage: 'KW Experience' },
        { date: '2020-07-21', address: '4 Beck Boulevard #7', commission: 1556.25, hst: 201.01, net: 1546.25, brokerage: 'KW Experience' },
        { date: '2020-07-21', address: '7 Levi Simon Trail', commission: 705.00, hst: 90.35, net: 695.00, brokerage: 'KW Experience' },
        { date: '2020-07-23', address: '397 Queen Street', commission: 4837.50, hst: 622.38, net: 4787.50, brokerage: 'KW Experience' },
        { date: '2020-07-23', address: 'Lot 95 Highway 93', commission: 412.50, hst: 52.33, net: 402.50, brokerage: 'KW Experience' },
        { date: '2020-07-28', address: '37 O\'donnell Court', commission: 2126.25, hst: 275.11, net: 2116.25, brokerage: 'KW Experience' },
        { date: '2020-07-31', address: '30 County Road 6 South', commission: 2437.50, hst: 313.63, net: 2412.50, brokerage: 'KW Experience' },
        { date: '2020-07-31', address: '420 Lakewood Drive', commission: 7875.00, hst: 1015.96, net: 7815.00, brokerage: 'KW Experience' },
        { date: '2020-08-04', address: '14 O\'shaughnessy Crescent', commission: 5740.00, hst: 741.00, net: 5700.00, brokerage: 'KW Experience' },
        { date: '2020-08-14', address: '248 First Street', commission: 2200.00, hst: 284.70, net: 2190.00, brokerage: 'KW Experience' },
        { date: '2020-08-14', address: '34 Bridle Road', commission: 4750.00, hst: 611.00, net: 4700.00, brokerage: 'KW Experience' },
        { date: '2020-08-14', address: '110 Heydon Avenue', commission: 2937.50, hst: 377.59, net: 2904.50, brokerage: 'KW Experience' },
        { date: '2020-08-18', address: '125 Poyntz Street', commission: 687.50, hst: 88.08, net: 677.50, brokerage: 'KW Experience' },
        { date: '2020-08-21', address: '64 Beck Boulevard', commission: 1801.25, hst: 232.86, net: 1791.25, brokerage: 'KW Experience' },
        { date: '2020-08-21', address: '3280 Fesserton Sideroad', commission: 3143.75, hst: 402.19, net: 3093.75, brokerage: 'KW Experience' },
        { date: '2020-08-26', address: '15 Marineland Road', commission: 860.63, hst: 110.58, net: 850.63, brokerage: 'KW Experience' },
        { date: '2020-08-28', address: '414 Elizabeth Street', commission: 900.00, hst: 115.70, net: 890.00, brokerage: 'KW Experience' },
        { date: '2020-08-28', address: '48 Moreau Parkway', commission: 330.00, hst: 41.60, net: 320.00, brokerage: 'KW Experience' },
        { date: '2020-08-31', address: '69 & 71 Polish Avenue', commission: 175.00, hst: 21.45, net: 165.00, brokerage: 'KW Experience' },
        { date: '2020-09-04', address: 'Lot 9 Farlain Lake Road East', commission: 175.00, hst: 21.45, net: 165.00, brokerage: 'KW Experience' },
        { date: '2020-09-04', address: '1511 Par Four Drive', commission: 1550.00, hst: 200.20, net: 1540.00, brokerage: 'KW Experience' },
        { date: '2020-09-04', address: '3358 Muskoka Street', commission: 3637.50, hst: 466.38, net: 3587.50, brokerage: 'KW Experience' },
        { date: '2020-09-04', address: '92 Balm Beach Road', commission: 4312.50, hst: 554.13, net: 4262.50, brokerage: 'KW Experience' },
        { date: '2020-09-08', address: '15 Charlebois Court West', commission: 6000.00, hst: 776.75, net: 5975.00, brokerage: 'KW Experience' },
        { date: '2020-09-11', address: '142 Evergreen Avenue', commission: 3312.50, hst: 424.13, net: 3262.50, brokerage: 'KW Experience' },
        { date: '2020-09-18', address: '7387 Country Road 9', commission: 687.38, hst: 86.11, net: 662.38, brokerage: 'KW Experience' },
        { date: '2020-09-22', address: '159 Goldfinch Crescent', commission: 1523.25, hst: 196.72, net: 1513.25, brokerage: 'KW Experience' },
        { date: '2020-09-29', address: '1197 Everton Road', commission: 125.00, hst: 13.00, net: 100.00, brokerage: 'KW Experience' },
        { date: '2020-09-29', address: '42 Farlain Lake Road East', commission: 125.00, hst: 13.00, net: 100.00, brokerage: 'KW Experience' },
        { date: '2020-10-02', address: '870 Birchwood Drive', commission: 1080.00, hst: 139.10, net: 1070.00, brokerage: 'KW Experience' },
        { date: '2020-10-06', address: '1888 Ashwood Avenue', commission: 8812.50, hst: 1139.13, net: 8762.50, brokerage: 'KW Experience' },
        { date: '2020-10-09', address: '30 Pennsylvania Avenue', commission: 4923.75, hst: 633.59, net: 4873.75, brokerage: 'KW Experience' },
        { date: '2020-10-16', address: '699 Aberdeen Boulevard #302', commission: 5875.00, hst: 757.25, net: 5825.00, brokerage: 'KW Experience' },
        { date: '2020-10-23', address: '7 Tan Avenue', commission: 8562.50, hst: 1106.63, net: 8512.50, brokerage: 'KW Experience' },
        { date: '2020-10-23', address: '2 Dorcas Avenue', commission: 3250.00, hst: 419.25, net: 3225.00, brokerage: 'KW Experience' },
        { date: '2020-10-27', address: '7 Bay Court', commission: 6500.00, hst: 838.50, net: 6450.00, brokerage: 'KW Experience' },
        { date: '2020-10-30', address: '90 Hawthorne Drive', commission: 2500.00, hst: 312.00, net: 2400.00, brokerage: 'KW Experience' },
        { date: '2020-10-30', address: '888 Hugel Avenue', commission: 8000.00, hst: 1033.50, net: 7950.00, brokerage: 'KW Experience' },
        { date: '2020-11-03', address: '228 Forest Harbour Parkway', commission: 1750.00, hst: 226.20, net: 1740.00, brokerage: 'KW Experience' },
        { date: '2020-11-06', address: '791 Ottawa Street', commission: 1728.13, hst: 221.41, net: 1703.13, brokerage: 'KW Experience' },
        { date: '2020-11-13', address: '274 Elizabeth Street', commission: 878.75, hst: 112.94, net: 868.75, brokerage: 'KW Experience' },
        { date: '2020-11-17', address: '21 56 Street', commission: 1600.00, hst: 206.70, net: 1590.00, brokerage: 'KW Experience' },
        { date: '2020-11-20', address: '129 Sandhill Crane Drive', commission: 487.50, hst: 60.13, net: 462.50, brokerage: 'KW Experience' },
        { date: '2020-11-23', address: '238 Bay Street', commission: 951.25, hst: 122.36, net: 941.25, brokerage: 'KW Experience' },
        { date: '2020-11-30', address: 'Lot17 Faesulae Road', commission: 950.00, hst: 120.25, net: 925.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-21', address: 'Lot 22 Concession 17 West', commission: 367.50, hst: 46.48, net: 357.50, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-21', address: '249 Thunder Beach Road', commission: 8125.00, hst: 1049.75, net: 8075.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-21', address: '856 Midland Point Road', commission: 14500.00, hst: 1872.00, net: 14400.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-31', address: '601 Ninth Avenue', commission: 450.00, hst: 48.75, net: 375.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-31', address: '230 Skylark Road', commission: 1358.00, hst: 175.24, net: 1348.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-31', address: '146 Rue Eric', commission: 9889.97, hst: 1279.20, net: 9839.97, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-31', address: 'Lot 17 Military Road', commission: 800.00, hst: 102.70, net: 790.00, brokerage: 'KW Experience (Official Realty)' },
        { date: '2020-12-31', address: '226 Churchland Drive', commission: 8437.50, hst: 1088.75, net: 8375.00, brokerage: 'KW Experience (Official Realty)' },
      ],
    },
    2021: {
      brokerage: 'KW Experience',
      ends: 100,
      totalGCI: 505598.34,
      totalHST: 63931.83,
      deals: [
        { date: '2021-01-08', address: '960 Cook Drive', commission: 5812.50, hst: 747.50, net: 5750.00 },
        { date: '2021-03-09', address: '10 Glenn Howard Court', commission: 9112.50, hst: 876.62, net: 6743.25 },
        { date: '2021-03-23', address: '77 Dock Lane #35', commission: 1312.50, hst: 126.26, net: 971.25 },
        { date: '2021-04-01', address: '13 Simcoe Street', commission: 655.75, hst: 63.08, net: 485.25 },
        { date: '2021-04-06', address: '619 Morningview Lane', commission: 15000.00, hst: 1443.00, net: 11100.00 },
        { date: '2021-04-06', address: '91 Raglan Street #403', commission: 5500.00, hst: 570.20, net: 4386.15 },
        { date: '2021-04-09', address: '18 Tonawanda Road', commission: 2740.00, hst: 318.58, net: 2450.60 },
        { date: '2021-04-09', address: '66 Vents Beach Road', commission: 1012.50, hst: 122.10, net: 939.25 },
        { date: '2021-04-09', address: '36 Birchwood Trail', commission: 7150.00, hst: 865.60, net: 6658.50 },
        { date: '2021-04-16', address: '574 Balm Beach Road East', commission: 9873.75, hst: 1224.14, net: 9416.50 },
        { date: '2021-04-16', address: '224 Church Street', commission: 937.50, hst: 110.51, net: 850.00 },
        { date: '2021-04-20', address: '36 & 37 Methodist Island', commission: 512.50, hst: 53.62, net: 412.50 },
        { date: '2021-04-23', address: '2741 Hodgins Road', commission: 1620.00, hst: 200.84, net: 1545.00 },
        { date: '2021-05-07', address: '355 Eighth Street', commission: 1550.00, hst: 199.87, net: 1537.50 },
        { date: '2021-05-07', address: 'Lot 26 Champlain Road', commission: 2750.00, hst: 349.37, net: 2687.50 },
        { date: '2021-05-14', address: '874 Birchwood Drive', commission: 7250.00, hst: 934.37, net: 7187.50 },
        { date: '2021-05-14', address: '458 West Street', commission: 5100.00, hst: 654.87, net: 5037.50 },
        { date: '2021-05-19', address: '171 Fox Street', commission: 844.00, hst: 105.66, net: 812.75 },
        { date: '2021-05-21', address: 'Lot 33 Giants Tomb Island', commission: 2475.00, hst: 312.00, net: 2400.00 },
        { date: '2021-05-21', address: '111 Church Street', commission: 6937.50, hst: 889.69, net: 6843.75 },
        { date: '2021-06-02', address: '543 O\'Leary Lane', commission: 5500.00, hst: 706.87, net: 5437.50 },
        { date: '2021-06-04', address: '663 Norman Crescent', commission: 6750.00, hst: 869.37, net: 6687.50 },
        { date: '2021-06-04', address: '458 Seguin Crescent', commission: 1243.75, hst: 153.56, net: 1181.25 },
        { date: '2021-06-09', address: '68 Bourgeois Beach Road', commission: 8750.00, hst: 1129.37, net: 8687.50 },
        { date: '2021-06-09', address: '8 Beaver Road', commission: 6787.50, hst: 874.25, net: 6725.00 },
        { date: '2021-06-09', address: '267 Woodlands Avenue', commission: 906.25, hst: 113.75, net: 875.00 },
        { date: '2021-06-11', address: '381 Lafontaine Road West', commission: 7437.50, hst: 958.75, net: 7375.00 },
        { date: '2021-06-18', address: '611 Bayport Boulevard', commission: 16975.00, hst: 2190.49, net: 16850.00 },
        { date: '2021-06-23', address: '77 Church Street', commission: 2806.25, hst: 360.75, net: 2775.00 },
        { date: '2021-06-23', address: '163 Mcarthur Drive', commission: 18450.00, hst: 2390.37, net: 18387.50 },
        { date: '2021-06-25', address: '6498 Line 4 North', commission: 5400.00, hst: 695.50, net: 5350.00 },
        { date: '2021-06-25', address: '106 Palmer Street', commission: 4225.00, hst: 545.19, net: 4193.75 },
        { date: '2021-06-25', address: 'Lot 34 Methodist Island', commission: 520.31, hst: 61.55, net: 473.44 },
        { date: '2021-06-28', address: '691 Lafontaine Road West', commission: 9125.00, hst: 1178.12, net: 9062.50 },
        { date: '2021-06-30', address: '314 Booth Road', commission: 1875.00, hst: 235.62, net: 1812.50 },
        { date: '2021-07-07', address: '8 Mann Street', commission: 2156.25, hst: 276.25, net: 2125.00 },
        { date: '2021-07-07', address: '11 Mundy Avenue', commission: 2843.75, hst: 365.63, net: 2812.50 },
        { date: '2021-07-07', address: '58 Methodist Island', commission: 4687.50, hst: 605.32, net: 4656.25 },
        { date: '2021-07-09', address: '35 Grew Crescent', commission: 6187.50, hst: 796.25, net: 6125.00 },
        { date: '2021-07-12', address: '26 Jury Drive', commission: 14001.80, hst: 1812.10, net: 13939.30 },
        { date: '2021-07-14', address: '320 Booth Road', commission: 1812.50, hst: 227.50, net: 1750.00 },
        { date: '2021-07-14', address: '278 Woodlands Avenue', commission: 450.00, hst: 56.47, net: 434.37 },
        { date: '2021-07-16', address: '256 Woodlands Avenue', commission: 387.50, hst: 46.32, net: 356.25 },
        { date: '2021-07-19', address: '12864 County Road 16', commission: 2656.25, hst: 341.25, net: 2625.00 },
        { date: '2021-07-19', address: '2814 Highway 320', commission: 961.72, hst: 120.96, net: 930.47 },
        { date: '2021-07-21', address: '560 Concession Road 15 West', commission: 11375.00, hst: 1470.62, net: 11312.50 },
        { date: '2021-07-21', address: '110 William Street', commission: 2531.25, hst: 325.00, net: 2500.00 },
        { date: '2021-07-23', address: '56 Maria Street', commission: 10625.00, hst: 1373.12, net: 10562.50 },
        { date: '2021-07-23', address: '3280 Fesserton Sideroad', commission: 11000.00, hst: 1421.87, net: 10937.50 },
        { date: '2021-07-23', address: '778 William Street #95', commission: 4762.50, hst: 611.00, net: 4700.00 },
        { date: '2021-07-23', address: '52 Dromore Crescent', commission: 8250.00, hst: 1064.37, net: 8187.50 },
        { date: '2021-07-28', address: '10 Concession 19 East', commission: 3906.25, hst: 503.75, net: 3875.00 },
        { date: '2021-07-28', address: '68 Wozniak Road', commission: 1031.25, hst: 130.00, net: 1000.00 },
        { date: '2021-08-11', address: '132 Fox Street', commission: 2156.25, hst: 272.18, net: 2093.75 },
        { date: '2021-08-13', address: '64 Meadows Avenue', commission: 2112.50, hst: 270.57, net: 2081.25 },
        { date: '2021-08-18', address: '965 Drummond Drive', commission: 6150.00, hst: 795.44, net: 6118.75 },
        { date: '2021-08-18', address: '136 Fox Street', commission: 4265.63, hst: 546.40, net: 4203.13 },
        { date: '2021-08-20', address: 'Lot 1762 Arthur Avenue', commission: 718.75, hst: 89.38, net: 687.50 },
        { date: '2021-08-20', address: 'Lot 1764 Arthur Avenue', commission: 718.75, hst: 89.38, net: 687.50 },
        { date: '2021-08-20', address: 'Lot 67 Pinecone Avenue', commission: 1390.63, hst: 176.72, net: 1359.38 },
        { date: '2021-08-23', address: 'Lot 28 Methodist Island', commission: 560.62, hst: 66.79, net: 513.75 },
        { date: '2021-08-25', address: '51 Topaz Street', commission: 6250.00, hst: 804.37, net: 6187.50 },
        { date: '2021-08-27', address: 'Lot 27 Methodist Island', commission: 412.50, hst: 49.57, net: 381.25 },
        { date: '2021-08-30', address: '55 Rue Camille', commission: 3656.25, hst: 463.13, net: 3562.50 },
        { date: '2021-09-03', address: '34 Oakwood Avenue', commission: 7250.00, hst: 938.44, net: 7218.75 },
        { date: '2021-09-03', address: 'Lot 21 Methodist Island', commission: 362.50, hst: 43.07, net: 331.25 },
        { date: '2021-09-10', address: '658 Oxbow Park Drive', commission: 19609.38, hst: 2539.06, net: 19531.26 },
        { date: '2021-09-15', address: '1523 Champlain Road', commission: 13750.00, hst: 1779.37, net: 13687.50 },
        { date: '2021-09-15', address: '15 Hillcrest Avenue', commission: 3687.50, hst: 471.25, net: 3625.00 },
        { date: '2021-09-15', address: '374 Borden Street', commission: 3468.75, hst: 438.75, net: 3375.00 },
        { date: '2021-09-24', address: '449 Birch Street', commission: 2650.00, hst: 340.44, net: 2618.75 },
        { date: '2021-10-08', address: '172 Eighth Street #206', commission: 4993.75, hst: 641.06, net: 4931.25 },
        { date: '2021-10-15', address: '123 Concession 15', commission: 12000.00, hst: 1551.87, net: 11937.50 },
        { date: '2021-10-22', address: '3926 Horseshoe Valley Road West', commission: 4312.50, hst: 556.57, net: 4281.25 },
        { date: '2021-10-25', address: '36 Viel Street', commission: 7862.50, hst: 1014.00, net: 7800.00 },
        { date: '2021-10-27', address: '506 Shewfelt Crescent', commission: 4218.12, hst: 544.30, net: 4186.87 },
        { date: '2021-10-29', address: '535 Johnson Street', commission: 3562.50, hst: 459.07, net: 3531.25 },
        { date: '2021-10-29', address: 'Lot 26 Champlain Road (2)', commission: 3631.25, hst: 463.93, net: 3568.75 },
        { date: '2021-11-05', address: '5 Severn River', commission: 4375.00, hst: 560.62, net: 4312.50 },
        { date: '2021-11-05', address: '587 River Road West #8', commission: 1625.00, hst: 203.14, net: 1562.50 },
        { date: '2021-11-10', address: '32 Lindsay Court', commission: 9400.00, hst: 1213.87, net: 9337.50 },
        { date: '2021-11-10', address: '396 Keller Drive', commission: 7875.00, hst: 1015.62, net: 7812.50 },
        { date: '2021-11-10', address: '120 Pillsbury Drive', commission: 1593.75, hst: 203.13, net: 1562.50 },
        { date: '2021-11-10', address: '107 Vista Blvd.', commission: 1846.87, hst: 231.96, net: 1784.37 },
        { date: '2021-11-12', address: '560 Johnson Street', commission: 5375.00, hst: 690.62, net: 5312.50 },
        { date: '2021-11-15', address: '1255 Fuller Avenue', commission: 9200.00, hst: 1187.87, net: 9137.50 },
        { date: '2021-11-22', address: '46 Hickling Trail', commission: 4573.12, hst: 590.45, net: 4541.87 },
        { date: '2021-11-24', address: '230 Robins Point Road', commission: 6875.00, hst: 889.69, net: 6843.75 },
        { date: '2021-11-26', address: '269 Dignard Avenue', commission: 438.19, hst: 54.93, net: 422.57 },
        { date: '2021-11-30', address: '424 Assiniboia Street', commission: 3749.38, hst: 483.36, net: 3718.13 },
        { date: '2021-12-01', address: '1591 Tiny Beaches Road North', commission: 5100.00, hst: 658.94, net: 5068.75 },
        { date: '2021-12-06', address: '1 Dufferin Street', commission: 6065.63, hst: 780.40, net: 6003.13 },
        { date: '2021-12-10', address: '39 Maria Street', commission: 5750.00, hst: 739.37, net: 5687.50 },
        { date: '2021-12-13', address: '740 Midland Avenue', commission: 780.63, hst: 97.42, net: 749.38 },
        { date: '2021-12-15', address: '4 Joliet Crescent', commission: 8250.00, hst: 1064.37, net: 8187.50 },
        { date: '2021-12-17', address: '32 Hunter Avenue', commission: 9625.00, hst: 1243.12, net: 9562.50 },
        { date: '2021-12-17', address: '411 Point Road', commission: 576.56, hst: 82.42, net: 545.31 },
        { date: '2021-12-20', address: '1277 Flos Road 8 East', commission: 10000.00, hst: 1291.87, net: 9937.50 },
        { date: '2021-12-23', address: '5760 County Road 90', commission: 5500.00, hst: 710.94, net: 5468.75 },
        { date: '2021-12-29', address: '30 Macavalley Road', commission: 2750.00, hst: 353.44, net: 2718.75 },
      ],
    },
    2023: {
      brokerage: 'KW Co-Elevation + KW Experience',
      ends: 46,
      totalGCI: 231875.48,
      totalHST: 28483.12,
      deals: [
        { date: '2023-01-04', address: '472 William St Upper', commission: 1025.00, hst: 113.76, net: 875.00, brokerage: '221097' },
        { date: '2023-01-17', address: '7 Westmount Dr N', commission: 5712.50, hst: 732.88, net: 5637.50, brokerage: '221032' },
        { date: '2023-01-30', address: '75 Mcdermitt Tr', commission: 1608.75, hst: 199.39, net: 1533.75, brokerage: '221037' },
        { date: '2023-02-07', address: '85 Bellisle Rd', commission: 1450.00, hst: 139.49, net: 1073.00, brokerage: '221036' },
        { date: '2023-03-03', address: '9 Cranbrooke Crt', commission: 8562.50, hst: 823.71, net: 6336.25, brokerage: '221104' },
        { date: '2023-03-06', address: '9 Celestine Crt', commission: 8125.00, hst: 781.62, net: 6012.50, brokerage: '230042' },
        { date: '2023-03-16', address: '8843 93 County Rd', commission: 7187.50, hst: 691.44, net: 5318.75, brokerage: '230043' },
        { date: '2023-05-25', address: '17 Jury Drive', commission: 1250.00, hst: 120.25, net: 925.00, brokerage: '210133' },
        { date: '2023-06-05', address: '226 Churchland Dr', commission: 8562.50, hst: 924.79, net: 7113.75, brokerage: '230184' },
        { date: '2023-06-07', address: '895 Hammond St', commission: 1098.00, hst: 124.43, net: 957.12, brokerage: '230275' },
        { date: '2023-06-15', address: '280 Aberdeen Blvd 111', commission: 4875.00, hst: 585.97, net: 4507.50, brokerage: '230355' },
        { date: '2023-06-22', address: '39 Maria St', commission: 6750.00, hst: 815.10, net: 6270.00, brokerage: '230227' },
        { date: '2023-06-23', address: '316 Seventh St', commission: 2875.00, hst: 341.57, net: 2627.50, brokerage: '230380' },
        { date: '2023-06-26', address: '363 Lafontaine Rd W', commission: 8500.00, hst: 1091.24, net: 8394.13, brokerage: '230249' },
        { date: '2023-06-28', address: '544 Keewatin Ave', commission: 625.00, hst: 71.50, net: 550.00, brokerage: '230444' },
        { date: '2023-06-28', address: '540 Keewatin Ave', commission: 1187.50, hst: 144.63, net: 1112.50, brokerage: '230445' },
        { date: '2023-06-29', address: '2224 Lakeshore Rd E', commission: 5684.38, hst: 729.22, net: 5609.38, brokerage: '230314' },
        { date: '2023-07-12', address: '79 Bellisle Rd', commission: 9062.50, hst: 1168.38, net: 8987.50, brokerage: '230259' },
        { date: '2023-07-12', address: '37 Easton Ave', commission: 7425.00, hst: 955.50, net: 7350.00, brokerage: '230285' },
        { date: '2023-07-21', address: '140 Campbell St', commission: 10000.00, hst: 1290.25, net: 9925.00, brokerage: '230475' },
        { date: '2023-07-21', address: '388 Robins Point Rd', commission: 11437.50, hst: 1477.13, net: 11362.50, brokerage: '230453' },
        { date: '2023-08-09', address: '280 Aberdeen Blvd 208', commission: 3750.00, hst: 477.75, net: 3675.00, brokerage: '230482' },
        { date: '2023-08-09', address: '14 Lisa St', commission: 600.00, hst: 68.25, net: 525.00, brokerage: '230572' },
        { date: '2023-08-15', address: '539 Nelson St', commission: 7125.00, hst: 916.50, net: 7050.00, brokerage: '230403' },
        { date: '2023-08-16', address: '28 Marchand Rd Upper', commission: 787.50, hst: 82.88, net: 637.50, brokerage: '230667' },
        { date: '2023-08-16', address: '28 Marchand Rd Lower', commission: 600.00, hst: 58.50, net: 450.00, brokerage: '230669' },
        { date: '2023-08-18', address: '578 Manly St', commission: 7562.50, hst: 973.38, net: 7487.50, brokerage: '230566' },
        { date: '2023-08-24', address: '27 Clarissa St', commission: 2437.50, hst: 307.13, net: 2362.50, brokerage: '230618' },
        { date: '2023-08-31', address: '829 8th Ave', commission: 1837.50, hst: 229.13, net: 1762.50, brokerage: '230515' },
        { date: '2023-09-01', address: '65 Wendake Rd', commission: 5062.50, hst: 648.38, net: 4987.50, brokerage: '230631' },
        { date: '2023-09-11', address: '70 Shoreline Rd (Opinion)', commission: 125.00, hst: 6.50, net: 50.00, brokerage: '230686' },
        { date: '2023-09-15', address: '14 Grier St', commission: 5400.00, hst: 692.25, net: 5325.00, brokerage: '230643' },
        { date: '2023-09-19', address: '1197 Shea Rd', commission: 4921.87, hst: 630.09, net: 4846.87, brokerage: '230664' },
        { date: '2023-09-25', address: '15 Berts Rd', commission: 4123.75, hst: 526.34, net: 4048.75, brokerage: '230676' },
        { date: '2023-09-27', address: '15 Vics Rd', commission: 1468.75, hst: 181.19, net: 1393.75, brokerage: '230712' },
        { date: '2023-09-28', address: '60 Copeland Creek Dr', commission: 8015.00, hst: 1032.20, net: 7940.00, brokerage: '230726' },
        { date: '2023-09-29', address: '415 17 Concession W', commission: 7361.86, hst: 947.29, net: 7286.86, brokerage: '230153' },
        { date: '2023-11-08', address: '128 Burke St', commission: 16250.00, hst: 2093.00, net: 16100.00, brokerage: '230165' },
        { date: '2023-11-08', address: '58 Nicort Rd', commission: 600.00, hst: 68.25, net: 525.00, brokerage: '230829' },
        { date: '2023-11-21', address: 'Lot 577 Forest Circle', commission: 1249.37, hst: 152.67, net: 1174.37, brokerage: '230838' },
        { date: '2023-11-22', address: '696 King St 93', commission: 6075.00, hst: 780.00, net: 6000.00, brokerage: '230812' },
        { date: '2023-12-11', address: '28 James St', commission: 6093.75, hst: 772.69, net: 5943.75, brokerage: '230846' },
        { date: '2023-12-11', address: '280 Aberdeen Blvd 208 (2)', commission: 425.00, hst: 45.50, net: 350.00, brokerage: '230961' },
        { date: '2023-12-12', address: '883 Midland Point Rd', commission: 17500.00, hst: 2255.50, net: 17350.00, brokerage: '230814' },
        { date: '2023-12-19', address: '91 Mitchells Beach Rd', commission: 6500.00, hst: 835.25, net: 6425.00, brokerage: '230876' },
        { date: '2023-12-31', address: '245 William St', commission: 3000.00, hst: 380.25, net: 2925.00, brokerage: '230915' },
      ],
    },
  };

  const years = [2025, 2024, 2023, 2022, 2021, 2020, 2019];
  const lifetimeGCI = years.reduce((s, y) => s + yearData[y].totalGCI, 0);
  const lifetimeEnds = years.reduce((s, y) => s + yearData[y].ends, 0);
  const lifetimeHST = years.reduce((s, y) => s + yearData[y].totalHST, 0);
  const fmt = (n) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmt2 = (n) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });

  const statBox = (label, value, color) => (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#111827', marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      {/* Lifetime Header */}
      <div style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius: 12, padding: '24px 28px', color: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#94a3b8', textTransform: 'uppercase' }}>Lifetime Career Stats</div>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>Jonathan Wallace</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>Georgian Bay Real Estate — 2019 to Present</div>
      </div>

      {/* Big Numbers */}
      <div style={{ display: 'flex', gap: 12 }}>
        {statBox('Lifetime Ends', lifetimeEnds, '#ea580c')}
        {statBox('Total GCI', fmt(lifetimeGCI), '#16a34a')}
        {statBox('Avg GCI / End', fmt(Math.round(lifetimeGCI / lifetimeEnds)), '#2563eb')}
        {statBox('Total HST', fmt(lifetimeHST), '#7c3aed')}
      </div>

      {/* Year by Year */}
      {years.map(year => {
        const yd = yearData[year];
        const isOpen = expandedYear === year;
        const avgPerDeal = yd.deals.length > 0 ? yd.totalGCI / yd.deals.length : 0;
        const topDeal = [...yd.deals].sort((a, b) => b.commission - a.commission)[0];

        return (
          <div key={year} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {/* Year Header — clickable */}
            <div
              onClick={() => setExpandedYear(isOpen ? null : year)}
              style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', cursor: 'pointer', gap: 16, background: isOpen ? '#f8fafc' : '#fff' }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#fff',
                background: year === 2025 ? '#16a34a' : year === 2024 ? '#ea580c' : year === 2023 ? '#0891b2' : year === 2022 ? '#6366f1' : year === 2021 ? '#d97706' : year === 2020 ? '#dc2626' : '#64748b' }}>
                {String(year).slice(2)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{year}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{yd.brokerage}</div>
              </div>
              <div style={{ textAlign: 'right', marginRight: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>{fmt(yd.totalGCI)}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{yd.ends} ends &middot; {yd.deals.length} cheques</div>
              </div>
              <ChevronDown size={18} style={{ color: '#9ca3af', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>

            {/* Year Summary Bar */}
            <div style={{ display: 'flex', gap: 1, padding: '0 20px 12px', borderBottom: isOpen ? '1px solid #e5e7eb' : 'none' }}>
              {[
                { l: 'Avg/Deal', v: fmt(Math.round(avgPerDeal)) },
                { l: 'HST Collected', v: fmt(yd.totalHST) },
                { l: 'Top Deal', v: topDeal ? fmt(Math.round(topDeal.commission)) : '—' },
                { l: 'Top Address', v: topDeal ? topDeal.address.slice(0, 28) : '—' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, padding: '6px 8px', background: '#f9fafb', borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>{s.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginTop: 2 }}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Expanded Deal List */}
            {isOpen && (
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Address</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Commission</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>HST</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Net</th>
                      {(year === 2025 || year === 2023 || year === 2022 || year === 2020) && <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Brokerage</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {yd.deals.map((d, i) => {
                      const dateStr = new Date(d.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                          <td style={{ padding: '8px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>{dateStr}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#111827' }}>{d.address}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>{fmt2(d.commission)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{fmt2(d.hst)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: d.net >= 10000 ? '#16a34a' : '#374151' }}>{fmt2(d.net)}</td>
                          {(year === 2025 || year === 2023 || year === 2022 || year === 2020) && <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: '#9ca3af' }}>{d.brokerage}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: '#111827' }}>TOTAL</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#6b7280' }}>{yd.deals.length} transactions</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#111827' }}>{fmt2(yd.totalGCI)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#6b7280' }}>{fmt2(yd.totalHST)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>{fmt2(yd.deals.reduce((s, d) => s + d.net, 0))}</td>
                      {(year === 2025 || year === 2023 || year === 2022 || year === 2020) && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}



      {/* Footer note */}
      <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: 8 }}>
        Source: KW Experience, KW Co-Elevation &amp; Faris Team tax worksheets &amp; agent earnings reports (2019–2025)
      </div>
    </div>
  );
}

// SYNCS & ROUTINES — Centralized status for all background sync jobs
// ─────────────────────────────────────────────
function SyncsSection() {
  const [sweepStatus, setSweepStatus] = useState(null);
  const [outlookSent, setOutlookSent] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    Promise.all([
      fetch('/api/ea/sweep-status').then(r => r.json()).catch(() => null),
      fetch('/api/ea/outlook-sent').then(r => r.json()).catch(() => null),
    ]).then(([sweep, outlook]) => {
      setSweepStatus(sweep);
      setOutlookSent(outlook);
      setLoading(false);
    });
  };

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 60000); return () => clearInterval(iv); }, []);

  const triggerSweep = async () => {
    setTriggering(true);
    try {
      await fetch('/api/ea/sweep-now', { method: 'POST' });
      await new Promise(r => setTimeout(r, 1000));
      fetchAll();
    } catch {} finally { setTriggering(false); }
  };

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';
  const statusDot = (ok) => <span style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? '#10b981' : '#ef4444', display: "inline-block" }} />;

  if (loading) return <Card><div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}><RefreshCw size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} /><div style={{ fontSize: 13 }}>Loading sync status...</div></div></Card>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <RotateCw size={18} color="#c8a96e" />
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Syncs & Routines</span>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>Background jobs that keep Agent HQ accurate. These run automatically and cross-reference your email activity across Gmail and Outlook.</p>
      </Card>

      {/* EA Auto-Sweep */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {statusDot(sweepStatus?.lastSweep?.status === 'success')}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827", flex: 1 }}>EA Auto-Sweep</span>
          <span style={{ fontSize: 10, color: "#10b981", background: "#ecfdf5", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>Every Hour — 24/7</span>
          <button onClick={triggerSweep} disabled={triggering} style={{ fontSize: 11, color: "#fff", background: "#2563eb", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>
            {triggering ? 'Running...' : 'Run Now'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px" }}>Automatically re-scans Gmail threads, detects CC-forwarded Outlook replies, and reconciles thread states every hour on Railway. Always running — no computer needed.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{sweepStatus?.totalSweeps || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Total Sweeps</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{sweepStatus?.lastSweep?.threadsProcessed || '—'}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Threads Scanned</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>{sweepStatus?.lastSweep?.ccForwardsFound || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>CC Forwards Found</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>{sweepStatus?.lastSweep?.stateChanges || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>State Changes</div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 10 }}>Last sweep: {fmtTime(sweepStatus?.lastSweep?.time)} — {sweepStatus?.lastSweep?.status || 'unknown'} ({sweepStatus?.lastSweep?.duration || 0}ms)</div>

        {/* Recent sweep log */}
        {sweepStatus?.recentLogs?.length > 1 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11, color: "#6b7280", cursor: "pointer" }}>Recent sweep history ({sweepStatus.recentLogs.length})</summary>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {sweepStatus.recentLogs.map((log, i) => (
                <div key={i} style={{ fontSize: 10, color: "#9ca3af", display: "flex", gap: 8 }}>
                  {statusDot(log.status === 'success')}
                  <span>{fmtTime(log.time)}</span>
                  <span style={{ color: "#6b7280" }}>{log.trigger}</span>
                  <span>{log.threadsProcessed || 0} threads</span>
                  {log.stateChanges > 0 && <span style={{ color: "#f59e0b", fontWeight: 600 }}>{log.stateChanges} changes</span>}
                  <span>{log.duration || 0}ms</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Outlook Sent Scraper */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {statusDot(!!outlookSent?.lastScrape)}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827", flex: 1 }}>Outlook Sent Scraper</span>
          <span style={{ fontSize: 10, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>Chrome Extension</span>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px" }}>Scrapes Outlook Sent Items via Chrome to catch replies Jonathan sent from Outlook that weren't CC'd to Gmail. Runs at 7AM & 5PM when Chrome is open.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{outlookSent?.scrapeCount || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Total Scrapes</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{outlookSent?.totalStored || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Emails Stored</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>{outlookSent?.recentCorrections?.length || 0}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Corrections Made</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#111827" }}>{fmtTime(outlookSent?.lastScrape)}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Last Scrape</div>
          </div>
        </div>

        {/* Recent corrections */}
        {outlookSent?.recentCorrections?.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11, color: "#6b7280", cursor: "pointer" }}>Recent corrections ({outlookSent.recentCorrections.length})</summary>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {outlookSent.recentCorrections.map((c, i) => (
                <div key={i} style={{ fontSize: 11, color: "#374151", background: "#ecfdf5", padding: "6px 10px", borderRadius: 6 }}>
                  <span style={{ fontWeight: 600 }}>{c.subject?.substring(0, 50)}</span>
                  <span style={{ color: "#9ca3af", marginLeft: 8 }}>{c.oldState} → {c.newState}</span>
                  <span style={{ color: "#9ca3af", marginLeft: 8, fontSize: 10 }}>{fmtTime(c.correctedAt)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* CC Workflow Status */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {statusDot(true)}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827", flex: 1 }}>CC-to-Gmail Forwarding</span>
          <span style={{ fontSize: 10, color: "#10b981", background: "#ecfdf5", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>ALWAYS ON</span>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>When you CC <strong>jonathan@faristeam.ca</strong> on Outlook replies, the forwarding rule sends a copy to Gmail. The EA triage engine detects these automatically — no scraping needed. This is the primary tracking method.</p>
      </Card>

      {/* Quick Links — Self-healing URL registry */}
      <QuickLinksPanel />
    </div>
  );
}

// ─────────────────────────────────────────────
// ACTIVE LISTINGS SECTION — Synced from BrokerBay, linked to FUB contacts
// ─────────────────────────────────────────────
function ActiveListingsSection() {
  const [listings, setListings] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openMlsId, setOpenMlsId] = useState(null);
  const [linkingMlsId, setLinkingMlsId] = useState(null);
  const [insightLoading, setInsightLoading] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteMlsId, setNoteMlsId] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [marketModalMlsId, setMarketModalMlsId] = useState(null);
  const [diagnosticsByMls, setDiagnosticsByMls] = useState({});
  const [diagnosticsSummary, setDiagnosticsSummary] = useState(null);
  const [feedbackMlsId, setFeedbackMlsId] = useState(null);
  const [weeklyEmailMlsId, setWeeklyEmailMlsId] = useState(null);
  const [toast, setToast] = useState(null); // { kind, mlsId?, prompt, title }

  // Click handler for any "request a refresh" button.
  // Logs the intent to /api/sync/request and copies the prompt
  // so Jonathan can paste it into Cowork to execute now.
  const requestSync = async ({ kind, mlsId = null, prompt, title }) => {
    // Log the intent (non-blocking — we don't let a logging failure break UX)
    fetch('/api/sync/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, mlsId }),
    }).catch(() => {});
    // Copy the prompt to clipboard
    try { await navigator.clipboard.writeText(prompt); } catch {}
    // Show toast
    setToast({ kind, mlsId, prompt, title });
    setTimeout(() => setToast(null), 4500);
  };

  const loadDiagnostics = async () => {
    try {
      const r = await fetch('/api/listings/diagnostics/all');
      const j = await r.json();
      if (j.ok) {
        const map = {};
        (j.rows || []).forEach(row => { map[row.mlsId] = row.diagnostics; });
        setDiagnosticsByMls(map);
        setDiagnosticsSummary(j.summary || null);
      }
    } catch (e) { console.error('[diagnostics]', e); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/listings');
      const j = await r.json();
      if (j.ok) {
        setListings(j.listings || []);
        setLastSyncedAt(j.lastSyncedAt || null);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
    loadDiagnostics();
  };
  useEffect(() => { load(); }, []);

  const genInsight = async (mlsId) => {
    setInsightLoading(mlsId);
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(mlsId)}/insight`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        setListings(prev => prev.map(l => l.mlsId === mlsId ? { ...l, lastInsight: j.insight } : l));
        setOpenMlsId(mlsId);
      } else {
        alert('Insight error: ' + (j.error || 'unknown'));
      }
    } catch (e) { alert(e.message); }
    setInsightLoading(null);
  };

  const addNote = async (mlsId) => {
    if (!noteDraft.trim()) return;
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(mlsId)}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteDraft.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setListings(prev => prev.map(l => l.mlsId === mlsId ? j.listing : l));
        setNoteDraft('');
        setNoteMlsId(null);
      }
    } catch (e) { alert(e.message); }
  };

  const unlink = async (mlsId, fubId) => {
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(mlsId)}/link/${encodeURIComponent(fubId)}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) {
        setListings(prev => prev.map(l => l.mlsId === mlsId ? { ...l, linkedContacts: (l.linkedContacts || []).filter(c => c.fubId !== fubId) } : l));
      }
    } catch (e) { alert(e.message); }
  };

  const availabilityColor = (a) => {
    const s = (a || '').toLowerCase();
    if (s.includes('sold')) return { bg: '#dcfce7', fg: '#166534' };
    if (s.includes('price change')) return { bg: '#fef3c7', fg: '#92400e' };
    if (s.includes('new')) return { bg: '#dbeafe', fg: '#1e40af' };
    return { bg: '#f3f4f6', fg: '#374151' };
  };

  const timeAgo = (iso) => {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  const openListing = openMlsId ? listings.find(l => l.mlsId === openMlsId) : null;

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Home size={20} color="#c8a96e" />
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Active Listings</h2>
          <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
            {listings.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
          <span>Last synced: <strong style={{ color: '#374151' }}>{timeAgo(lastSyncedAt)}</strong></span>
          <button onClick={load} title="Reload from server" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <RotateCw size={12} />Reload
          </button>
          <button
            onClick={() => requestSync({
              kind: 'full-refresh',
              prompt: 'refresh my active listings, pull listtrac stats, then run comp watch',
              title: 'Full Refresh — all 3 data sources',
            })}
            title="BrokerBay + ListTrac + Comp Watch — copies prompt to clipboard"
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <RefreshCw size={12} />Refresh All Data
          </button>
          <button onClick={() => setSyncModalOpen(true)} title="Granular sync options" style={{ background: 'transparent', border: 'none', color: '#6b7280', fontSize: 11, textDecoration: 'underline', cursor: 'pointer', padding: '6px 4px' }}>
            Options…
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading…</div>}

      {!loading && !listings.length && (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: 10, border: '1px dashed #d1d5db' }}>
          No listings synced yet. Ask Claude to refresh from BrokerBay.
        </div>
      )}

      {/* Diagnostics summary strip */}
      {diagnosticsSummary && diagnosticsSummary.totalActive > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: 10, background: 'linear-gradient(135deg,#fefce8,#fff)', border: '1px solid #fde68a', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: '#78350f', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Portfolio pulse:</div>
          {diagnosticsSummary.cmaDue > 0 && (
            <span style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
              {diagnosticsSummary.cmaDue} CMA{diagnosticsSummary.cmaDue !== 1 ? 's' : ''} due (7d+)
            </span>
          )}
          {diagnosticsSummary.needsPriceReview > 0 && (
            <span style={{ fontSize: 11, background: '#fef3c7', color: '#78350f', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
              {diagnosticsSummary.needsPriceReview} need price review
            </span>
          )}
          {diagnosticsSummary.noShowingsEver > 0 && (
            <span style={{ fontSize: 11, background: '#fef2f2', color: '#b91c1c', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
              {diagnosticsSummary.noShowingsEver} zero showings
            </span>
          )}
          {diagnosticsSummary.avgShowingsPerOffer !== null && (
            <span style={{ fontSize: 11, background: '#ecfdf5', color: '#065f46', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
              Avg {diagnosticsSummary.avgShowingsPerOffer} showings/offer
            </span>
          )}
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {listings.map(l => {
          const ac = availabilityColor(l.availability);
          return (
            <div key={l.mlsId} style={{ border: '1px solid #ede9fe', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.address}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{l.cityPostal}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: ac.bg, color: ac.fg, whiteSpace: 'nowrap' }}>{l.availability}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#c8a96e' }}>{l.price}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>DOM {l.dom}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{l.neighborhood}</div>
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.3 }}>MLS {l.mlsId} · {l.type}</div>

              {/* ListTrac stats strip */}
              {l.stats ? (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{l.stats.views.toLocaleString()}</div>
                      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Views{l.stats.viewsChangePct !== null && l.stats.viewsChangePct !== undefined ? ` ${l.stats.viewsChangePct >= 0 ? '+' : ''}${l.stats.viewsChangePct}%` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: l.stats.inquiries > 0 ? '#16a34a' : '#0f172a' }}>{l.stats.inquiries}</div>
                      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Inquiries</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{l.stats.favorites}</div>
                      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Favorites</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{l.stats.shares}</div>
                      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Shares</div>
                    </div>
                  </div>
                  {l.stats.topCities?.length > 0 && (
                    <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>
                      <strong style={{ color: '#0f172a', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>Buyers from:</strong>
                      {l.stats.topCities.slice(0, 4).map((c, i) => (
                        <span key={c.postalPrefix + i}>{i > 0 ? ', ' : ''}{c.city} ({c.views})</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: '#fefce8', border: '1px dashed #eab308', borderRadius: 8, padding: 6, fontSize: 10, color: '#854d0e', textAlign: 'center' }}>
                  No ListTrac data yet · ask Claude to "pull listtrac"
                </div>
              )}

              {/* Market Context strip (comps + competition) */}
              {l.marketContext ? (
                <div onClick={() => setMarketModalMlsId(l.mlsId)} style={{ cursor: 'pointer', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                  <span style={{ color: '#166534' }}>
                    <strong>{l.marketContext.competition?.length || 0}</strong> new competition · <strong>{l.marketContext.comps?.length || 0}</strong> recent solds{l.marketContext.actionPlan ? ' · Action plan ready' : ''}
                  </span>
                  <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>View →</span>
                </div>
              ) : (
                <div style={{ background: '#eff6ff', border: '1px dashed #93c5fd', borderRadius: 8, padding: 6, fontSize: 10, color: '#1e40af', textAlign: 'center' }}>
                  No comp data yet · ask Claude to "run comp watch"
                </div>
              )}

              {/* Diagnostic badges */}
              {(() => {
                const d = diagnosticsByMls[l.mlsId];
                if (!d) return null;
                const badges = [];
                if (d.flags.cmaIsStale) badges.push({ label: `CMA due (${d.daysSinceCompRefresh !== null ? d.daysSinceCompRefresh + 'd' : 'never'})`, bg: '#fee2e2', fg: '#991b1b' });
                if (d.flags.noShowings7Days) badges.push({ label: `${d.daysSinceLastShowing}d no showing — price review`, bg: '#fef3c7', fg: '#78350f' });
                if (d.flags.noShowingsEver) badges.push({ label: `${d.dom}d · zero showings ever`, bg: '#fef2f2', fg: '#b91c1c' });
                if (d.flags.usedAsComp) badges.push({ label: `${d.showingsCount} shows · 0 offers — used as comp`, bg: '#fef2f2', fg: '#b91c1c' });
                if (d.showingsCount > 0 && d.offersReceived > 0) badges.push({ label: `${d.showingsPerOffer} shows / offer`, bg: '#ecfdf5', fg: '#065f46' });
                if (d.listToSaleRatio !== null) badges.push({ label: `${(d.listToSaleRatio * 100).toFixed(1)}% list:sale`, bg: '#dbeafe', fg: '#1e40af' });
                if (!badges.length) return null;
                return (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {badges.map((b, i) => (
                      <span key={i} style={{ fontSize: 10, background: b.bg, color: b.fg, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{b.label}</span>
                    ))}
                  </div>
                );
              })()}

              {/* Linked contacts */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(l.linkedContacts || []).map(c => (
                  <div key={c.fubId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, background: '#f9fafb', padding: '4px 8px', borderRadius: 6 }}>
                    <span><strong>{c.name}</strong> <span style={{ color: '#6b7280' }}>· {c.role}</span></span>
                    <button onClick={() => unlink(l.mlsId, c.fubId)} title="Unlink" style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 2 }}><X size={12} /></button>
                  </div>
                ))}
                {!l.linkedContacts?.length && <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>No FUB contacts linked</div>}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                <button
                  onClick={() => requestSync({
                    kind: 'update-stats',
                    mlsId: l.mlsId,
                    prompt: `pull listtrac stats for MLS# ${l.mlsId} (${l.address})`,
                    title: `Update Stats — ${l.address}`,
                  })}
                  title="Re-pull ListTrac views / inquiries / favorites for this listing — copies prompt for Cowork"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#eef6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#1d4ed8' }}>
                  <RotateCw size={11} />Update Stats
                </button>
                <button
                  onClick={() => requestSync({
                    kind: 'run-comps',
                    mlsId: l.mlsId,
                    prompt: `run comp watch for MLS# ${l.mlsId} (${l.address})`,
                    title: `Run Comps — ${l.address}`,
                  })}
                  title="Re-scan REALM for recent solds + new competition — copies prompt for Cowork"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#166534' }}>
                  <BarChart3 size={11} />Run Comps
                </button>
                <button onClick={() => genInsight(l.mlsId)} disabled={insightLoading === l.mlsId} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  <Sparkles size={11} />{insightLoading === l.mlsId ? 'Thinking…' : (l.lastInsight ? 'Re-run AI' : 'AI Insight')}
                </button>
                <button onClick={() => setWeeklyEmailMlsId(l.mlsId)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#3730a3' }}>
                  <Mail size={11} />Weekly Email
                </button>
                <button onClick={() => setFeedbackMlsId(l.mlsId)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#166534' }}>
                  <MessageSquare size={11} />Feedback{diagnosticsByMls[l.mlsId]?.showingsCount ? ` (${diagnosticsByMls[l.mlsId].showingsCount})` : ''}
                </button>
                {l.lastInsight && (
                  <button onClick={() => setOpenMlsId(l.mlsId)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                    <Eye size={11} />AI
                  </button>
                )}
                <button onClick={() => setLinkingMlsId(l.mlsId)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                  <UserPlus size={11} />Link
                </button>
                <button onClick={() => setNoteMlsId(l.mlsId)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                  <PenLine size={11} />Note{l.notes?.length ? ` (${l.notes.length})` : ''}
                </button>
              </div>

              {/* Inline note composer */}
              {noteMlsId === l.mlsId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#f9fafb', padding: 8, borderRadius: 6 }}>
                  <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Context for AI: seller motivation, price rationale, open houses, offers received..." style={{ fontSize: 12, padding: 6, border: '1px solid #e5e7eb', borderRadius: 6, resize: 'vertical', minHeight: 60 }} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => addNote(l.mlsId)} style={{ background: '#c8a96e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => { setNoteMlsId(null); setNoteDraft(''); }} style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#6b7280' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Insight modal */}
      {openListing?.lastInsight && (
        <div onClick={() => setOpenMlsId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{openListing.address}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{openListing.cityPostal} · {openListing.price} · DOM {openListing.dom}</div>
              </div>
              <button onClick={() => setOpenMlsId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: '#111827', whiteSpace: 'pre-wrap' }}>{openListing.lastInsight.text}</div>
            <div style={{ marginTop: 12, fontSize: 10, color: '#9ca3af' }}>Generated {timeAgo(openListing.lastInsight.generatedAt)}</div>
          </div>
        </div>
      )}

      {/* Link contact modal */}
      {linkingMlsId && <LinkFubContactModal mlsId={linkingMlsId} onClose={() => setLinkingMlsId(null)} onLinked={(listing) => {
        setListings(prev => prev.map(l => l.mlsId === listing.mlsId ? listing : l));
        setLinkingMlsId(null);
      }} />}

      {/* Market Context modal */}
      {marketModalMlsId && (() => {
        const l = listings.find(x => x.mlsId === marketModalMlsId);
        if (!l?.marketContext) return null;
        const mc = l.marketContext;
        return (
          <div onClick={() => setMarketModalMlsId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 780, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Market Context — {l.address}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{l.cityPostal} · {l.price} · DOM {l.dom} · Scraped {timeAgo(mc.scrapedAt)}</div>
                </div>
                <button onClick={() => setMarketModalMlsId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>

              {mc.actionPlan && (
                <div style={{ background: 'linear-gradient(135deg,#fef3c7,#fefce8)', border: '1px solid #fde68a', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Sparkles size={14} color="#c8a96e" />
                    <strong style={{ fontSize: 12, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.5 }}>Seller Action Plan</strong>
                    <span style={{ fontSize: 10, color: '#78350f', marginLeft: 'auto' }}>Generated {timeAgo(mc.actionPlan.generatedAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', color: '#1f2937' }}>{mc.actionPlan.text}</div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Recent Solds ({mc.comps?.length || 0})</div>
                  {mc.comps?.length ? mc.comps.map((c, i) => (
                    <div key={c.mlsId + i} style={{ padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.address}</div>
                      <div style={{ color: '#475569', marginTop: 2 }}>{c.price} · {c.beds}bed/{c.baths}bath · {c.sqft} · {c.type}</div>
                      <div style={{ color: '#64748b', marginTop: 2, fontSize: 10 }}>Sold {c.soldDate} · {c.dom} DOM{c.priceChange ? ` · drop ${c.priceChange}` : ''} · MLS {c.mlsId}</div>
                    </div>
                  )) : <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>No comps matched</div>}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>New Competition ({mc.competition?.length || 0})</div>
                  {mc.competition?.length ? mc.competition.map((c, i) => (
                    <div key={c.mlsId + i} style={{ padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.address}</div>
                      <div style={{ color: '#475569', marginTop: 2 }}>{c.price} · {c.beds}bed/{c.baths}bath · {c.sqft} · {c.type}</div>
                      <div style={{ color: '#64748b', marginTop: 2, fontSize: 10 }}>Listed {c.listedDate} · {c.dom} DOM · MLS {c.mlsId}</div>
                    </div>
                  )) : <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>No new competition</div>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sync Fresh Data modal */}
      {syncModalOpen && (
        <div onClick={() => setSyncModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Sync Fresh Data</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Claude drives BrokerBay + ListTrac in Chrome to refresh this dashboard.</div>
              </div>
              <button onClick={() => setSyncModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
            </div>

            {[
              { title: 'Refresh everything (recommended)', prompt: 'refresh my active listings, pull listtrac stats, then run comp watch', note: 'BrokerBay → ListTrac → REALM comps. ~5 minutes.' },
              { title: 'Refresh active listings only', prompt: 'refresh my active listings', note: 'Just the BrokerBay list. ~30 seconds.' },
              { title: 'Refresh ListTrac stats only', prompt: 'pull listtrac', note: 'Assumes listings are already synced. ~2 minutes.' },
              { title: 'Run comp watch only', prompt: 'run comp watch', note: 'REALM scan for recent solds + new competition per listing. ~3 minutes.' },
            ].map((item, idx) => (
              <div key={idx} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: idx === 0 ? '#fffbeb' : '#f9fafb' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 6 }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <code style={{ flex: 1, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: '#0f172a' }}>{item.prompt}</code>
                  <button onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(item.prompt);
                      setCopiedPrompt(item.prompt);
                      setTimeout(() => setCopiedPrompt(null), 1800);
                    } catch { alert('Clipboard blocked — select and copy manually'); }
                  }} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#c8a96e', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {copiedPrompt === item.prompt ? <><Check size={11} />Copied</> : <>Copy</>}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{item.note}</div>
              </div>
            ))}

            <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', borderRadius: 8, fontSize: 11, color: '#3730a3', lineHeight: 1.5 }}>
              <strong>How it works:</strong> Copy one of the prompts above, open Claude in Cowork mode, and paste. Claude drives Chrome to log into BrokerBay and ListTrac (via your existing REALM session), scrapes each listing, and POSTs the data back here.
              <br /><br />
              <strong>Requirements:</strong> Chrome extension connected · REALM logged in · the <code style={{ background: '#fff', padding: '1px 4px', borderRadius: 3 }}>brokerbay-active-listings</code> and <code style={{ background: '#fff', padding: '1px 4px', borderRadius: 3 }}>realm-listtrac-stats</code> skills installed.
            </div>
          </div>
        </div>
      )}

      {/* Showing Feedback modal */}
      {feedbackMlsId && (() => {
        const l = listings.find(x => x.mlsId === feedbackMlsId);
        if (!l) return null;
        return <FeedbackModal listing={l} onClose={() => setFeedbackMlsId(null)} onSaved={() => loadDiagnostics()} />;
      })()}

      {/* Weekly Email modal */}
      {weeklyEmailMlsId && (() => {
        const l = listings.find(x => x.mlsId === weeklyEmailMlsId);
        if (!l) return null;
        return <WeeklyEmailModal listing={l} onClose={() => setWeeklyEmailMlsId(null)} />;
      })()}

      {/* Sync-request toast */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
            background: '#0f172a', color: '#fff', borderRadius: 12,
            padding: '14px 18px', boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
            maxWidth: 380, cursor: 'pointer', fontSize: 12, lineHeight: 1.5,
            border: '1px solid #1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Check size={14} color="#4ade80" />
            <strong style={{ fontSize: 13 }}>{toast.title}</strong>
          </div>
          <div style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Prompt copied. Open Cowork and paste to run.
          </div>
          <code style={{ display: 'block', background: '#1e293b', padding: '6px 8px', borderRadius: 6, fontSize: 11, color: '#e2e8f0', fontFamily: 'ui-monospace, SFMono-Regular, monospace', wordBreak: 'break-word' }}>
            {toast.prompt}
          </code>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>click to dismiss</div>
        </div>
      )}
    </div>
  );
}

function FeedbackModal({ listing, onClose, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    type: 'showing',
    date: new Date().toISOString().slice(0, 10),
    showingAgent: '',
    brokerage: '',
    interest: '',
    priceFeedback: '',
    conditionFeedback: '',
    objections: '',
    notes: '',
    offerAmount: '',
    offerConditions: '',
    offerStatus: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(listing.mlsId)}/feedback`);
      const j = await r.json();
      if (j.ok) { setEntries(j.feedback || []); setDiag(j.diagnostics || null); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [listing.mlsId]);

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        type: form.type,
        date: new Date(form.date + 'T12:00:00').toISOString(),
        showingAgent: form.showingAgent,
        brokerage: form.brokerage,
        interest: form.interest,
        priceFeedback: form.priceFeedback,
        conditionFeedback: form.conditionFeedback,
        objections: form.objections,
        notes: form.notes,
        offerMade: form.offerAmount ? {
          amount: Number(form.offerAmount.replace(/[^0-9]/g, '')),
          conditions: form.offerConditions,
          status: form.offerStatus || 'pending',
        } : null,
      };
      const r = await fetch(`/api/listings/${encodeURIComponent(listing.mlsId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        setForm({ type: 'showing', date: new Date().toISOString().slice(0, 10), showingAgent: '', brokerage: '', interest: '', priceFeedback: '', conditionFeedback: '', objections: '', notes: '', offerAmount: '', offerConditions: '', offerStatus: '' });
        await load();
        onSaved?.();
      } else {
        alert('Error: ' + (j.error || 'unknown'));
      }
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const del = async (entryId) => {
    if (!window.confirm('Remove this feedback entry?')) return;
    try {
      await fetch(`/api/listings/${encodeURIComponent(listing.mlsId)}/feedback/${entryId}`, { method: 'DELETE' });
      load();
      onSaved?.();
    } catch (e) { alert(e.message); }
  };

  const labelStyle = { fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 };
  const inputStyle = { padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 780, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Showing Feedback — {listing.address}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{listing.cityPostal} · {listing.price} · DOM {listing.dom}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>

        {/* Diagnostics snapshot */}
        {diag && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16, padding: 10, background: '#f9fafb', borderRadius: 8 }}>
            <div><div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{diag.showingsCount}</div><div style={labelStyle}>Showings</div></div>
            <div><div style={{ fontSize: 16, fontWeight: 700, color: diag.offersReceived > 0 ? '#16a34a' : '#0f172a' }}>{diag.offersReceived}</div><div style={labelStyle}>Offers</div></div>
            <div><div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{diag.showingsPerOffer ?? '—'}</div><div style={labelStyle}>Shows / Offer</div></div>
            <div><div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{diag.daysSinceLastShowing ?? '—'}</div><div style={labelStyle}>Days Since</div></div>
          </div>
        )}

        {/* New entry form */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 16, background: '#fffbeb' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Log New Feedback</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={labelStyle}>Type</label>
              <select value={form.type} onChange={e => setF('type', e.target.value)} style={inputStyle}>
                <option value="showing">Showing</option>
                <option value="open-house">Open House</option>
                <option value="offer">Offer Only</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div><label style={labelStyle}>Date</label><input type="date" value={form.date} onChange={e => setF('date', e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Showing Agent</label><input type="text" value={form.showingAgent} onChange={e => setF('showingAgent', e.target.value)} placeholder="Name" style={inputStyle} /></div>
            <div><label style={labelStyle}>Brokerage</label><input type="text" value={form.brokerage} onChange={e => setF('brokerage', e.target.value)} placeholder="Re/Max, Royal LePage..." style={inputStyle} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={labelStyle}>Interest Level</label>
              <select value={form.interest} onChange={e => setF('interest', e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">Not interested</option>
              </select>
            </div>
            <div><label style={labelStyle}>Price Feedback</label>
              <select value={form.priceFeedback} onChange={e => setF('priceFeedback', e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="low">Priced low</option>
                <option value="fair">Fair</option>
                <option value="high">A bit high</option>
                <option value="too-high">Too high</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Objections / Condition Feedback</label>
            <textarea value={form.objections} onChange={e => setF('objections', e.target.value)} placeholder="e.g. kitchen dated, needs new roof, backyard too small..." style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Internal Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Your own notes — not shared with seller" style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div><label style={labelStyle}>Offer Amount (if made)</label><input type="text" value={form.offerAmount} onChange={e => setF('offerAmount', e.target.value)} placeholder="$000,000" style={inputStyle} /></div>
            <div><label style={labelStyle}>Offer Conditions</label><input type="text" value={form.offerConditions} onChange={e => setF('offerConditions', e.target.value)} placeholder="Financing, inspection..." style={inputStyle} /></div>
            <div><label style={labelStyle}>Offer Status</label>
              <select value={form.offerStatus} onChange={e => setF('offerStatus', e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="countered">Countered</option>
              </select>
            </div>
          </div>
          <button onClick={save} disabled={saving} style={{ background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save Feedback'}
          </button>
        </div>

        {/* History */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            History ({entries.length})
          </div>
          {loading && <div style={{ color: '#9ca3af', fontSize: 12 }}>Loading…</div>}
          {!loading && !entries.length && <div style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>No feedback logged yet. Add the first entry above.</div>}
          {entries.map(e => (
            <div key={e.id} style={{ padding: 10, borderBottom: '1px solid #f1f5f9', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {e.date.slice(0, 10)} · {e.type}{e.showingAgent ? ` · ${e.showingAgent}` : ''}{e.brokerage ? ` (${e.brokerage})` : ''}
                  </div>
                  <div style={{ color: '#475569', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {e.interest && <span>Interest: <strong>{e.interest}</strong></span>}
                    {e.priceFeedback && <span>Price: <strong>{e.priceFeedback}</strong></span>}
                    {e.offerMade && <span style={{ color: '#16a34a' }}>Offer: <strong>${e.offerMade.amount.toLocaleString()}</strong> ({e.offerMade.status})</span>}
                  </div>
                  {e.objections && <div style={{ color: '#78350f', marginTop: 3, fontStyle: 'italic' }}>"{e.objections}"</div>}
                  {e.notes && <div style={{ color: '#64748b', marginTop: 3, fontSize: 10 }}>Note: {e.notes}</div>}
                </div>
                <button onClick={() => del(e.id)} title="Delete" style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 2 }}><X size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeeklyEmailModal({ listing, onClose }) {
  const [draft, setDraft] = useState(listing.lastWeeklyEmail || null);
  const [generating, setGenerating] = useState(false);
  const [subject, setSubject] = useState(draft?.subject || '');
  const [body, setBody] = useState(draft?.body || '');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(listing.mlsId)}/weekly-email`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) { setDraft(j.draft); setSubject(j.draft.subject); setBody(j.draft.body); }
      else alert('Error: ' + (j.error || 'unknown'));
    } catch (e) { alert(e.message); }
    setGenerating(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { alert('Clipboard blocked — select text manually'); }
  };

  const seller = (listing.linkedContacts || []).find(c => c.role === 'seller');
  // Open in Follow Up Boss so sends are tracked in the contact card activity log.
  // Pre-fill subject and body; include `to=` if we have the seller's email
  // (from linkedContacts), otherwise leave it blank so FUB's compose modal
  // lets Jonathan pick the right contact.
  const openInFub = () => {
    const sellerEmail = seller?.email || '';
    const base = 'https://app.followupboss.com/app/inbox/compose';
    const qs = new URLSearchParams();
    if (sellerEmail) qs.set('to', sellerEmail);
    qs.set('subject', subject);
    qs.set('body', body);
    window.open(`${base}?${qs.toString()}`, '_blank');
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Weekly Seller Email — {listing.address}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{seller ? `To: ${seller.name}` : 'No seller linked — link a FUB contact with role "seller" for personalized greeting'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>

        {!draft && (
          <div style={{ padding: 24, textAlign: 'center', background: '#f9fafb', borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
              Generate an AI-drafted update using fresh ListTrac stats, new solds, new competition, showing feedback, and diagnostics.
            </div>
            <button onClick={generate} disabled={generating} style={{ background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {generating ? 'Drafting…' : 'Generate Draft'}
            </button>
          </div>
        )}

        {draft && (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Subject</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Body (editable)</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} style={{ width: '100%', minHeight: 340, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#c8a96e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {copied ? <><Check size={12} />Copied</> : <>Copy</>}
              </button>
              <button onClick={openInFub} title="Opens Follow Up Boss compose with subject + body pre-filled. Sent email is logged on the contact card." style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <Mail size={12} />Open in Follow Up Boss
              </button>
              <button onClick={generate} disabled={generating} style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
              {draft.generatedAt && <span style={{ alignSelf: 'center', fontSize: 10, color: '#9ca3af' }}>Generated {Math.round((Date.now() - new Date(draft.generatedAt).getTime()) / 60000)}m ago</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LinkFubContactModal({ mlsId, onClose, onLinked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [role, setRole] = useState('seller');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/listings/contacts/search?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        setResults(j.results || []);
      } catch (e) { console.error(e); }
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const link = async (contact) => {
    try {
      const r = await fetch(`/api/listings/${encodeURIComponent(mlsId)}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fubId: contact.fubId, name: contact.name, role }),
      });
      const j = await r.json();
      if (j.ok) onLinked(j.listing);
      else alert('Link error: ' + (j.error || 'unknown'));
    } catch (e) { alert(e.message); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Link FUB Contact</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select value={role} onChange={e => setRole(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13 }}>
            <option value="seller">Seller</option>
            <option value="buyer">Buyer</option>
            <option value="interested">Interested</option>
            <option value="co-listing">Co-Listing</option>
            <option value="other">Other</option>
          </select>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search FUB by name, email, phone…" style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {searching && <div style={{ padding: 12, color: '#9ca3af', fontSize: 12 }}>Searching…</div>}
          {!searching && !results.length && q && <div style={{ padding: 12, color: '#9ca3af', fontSize: 12 }}>No matches in FUB</div>}
          {results.map(c => (
            <button key={c.fubId} onClick={() => link(c)} style={{ textAlign: 'left', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name || '(no name)'}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{c.email || '—'} · {c.phone || '—'} · {c.stage || 'no stage'}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SPHERE SECTION
// Tiered relationship management over FUB contacts.
// Reads /api/sphere/contacts, groups by tier (Advocate / A / B / C),
// surfaces overdue contacts, lets you log touches from the dashboard.
// ─────────────────────────────────────────────
function SphereSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overdue');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [busyId, setBusyId] = useState(null); // { fubId, type } while a quick-log POST is in flight
  const [toast, setToast] = useState(null);
  const [editingFubId, setEditingFubId] = useState(null); // contact whose detail drawer is open
  const [searchQuery, setSearchQuery] = useState(''); // name/email search across all tiers

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const url = '/api/sphere/contacts' + (refresh ? '?refresh=true' : '');
      const r = await fetch(url);
      const j = await r.json();
      if (j.ok) setData(j);
      else setData({ error: j.error });
    } catch (e) { setData({ error: e.message }); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // One-tap quick-log: optionally open a channel (tel:/sms:/web URL), then POST
  // the touch to FUB. Refreshes the list so the contact drops off Overdue.
  // openMode: null (no channel), 'self' (window.location for tel:/sms:), 'tab' (new tab)
  const quickLog = async (contact, type, channelUrl = null, openMode = null) => {
    const labels = { call: 'Call', text: 'Text', email: 'Email', popby: 'Pop-by', meeting: 'Meeting', other: 'Touch' };
    setBusyId({ fubId: contact.fubId, type });
    if (channelUrl) {
      if (openMode === 'tab') window.open(channelUrl, '_blank', 'noopener,noreferrer');
      else if (openMode === 'self') window.location.href = channelUrl;
    }
    try {
      const r = await fetch('/api/sphere/log-touch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fubId: contact.fubId, type }),
      });
      const j = await r.json();
      if (j.ok) {
        setToast(`${labels[type] || 'Touch'} logged: ${contact.name}`);
        setTimeout(() => setToast(null), 2500);
        load(true); // refresh — overdue contacts will drop off
      } else {
        setToast(`Couldn't log: ${j.error || 'unknown error'}`);
        setTimeout(() => setToast(null), 4000);
      }
    } catch (e) {
      setToast(`Couldn't log: ${e.message}`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusyId(null);
    }
  };

  const tierColor = (tier) => ({
    advocate: { fg: '#7c2d12', bg: '#fef3c7', border: '#fde68a' },
    a:        { fg: '#991b1b', bg: '#fee2e2', border: '#fecaca' },
    b:        { fg: '#1e40af', bg: '#dbeafe', border: '#bfdbfe' },
    c:        { fg: '#374151', bg: '#f3f4f6', border: '#e5e7eb' },
  }[tier] || { fg: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' });

  const statusColor = (status) => ({
    red:    { fg: '#991b1b', bg: '#fee2e2', label: 'OVERDUE' },
    amber:  { fg: '#78350f', bg: '#fef3c7', label: 'Due soon' },
    green:  { fg: '#065f46', bg: '#d1fae5', label: 'On track' },
    unknown:{ fg: '#6b7280', bg: '#f3f4f6', label: 'No data' },
  }[status] || { fg: '#6b7280', bg: '#f3f4f6', label: status });

  const tierTabs = [
    { key: 'overdue',  label: 'Overdue' },
    { key: 'advocate', label: 'Advocate' },
    { key: 'a',        label: 'A' },
    { key: 'b',        label: 'B' },
    { key: 'c',        label: 'C' },
    { key: 'untagged', label: 'Untagged' },
  ];

  const counts = data?.counts || {};
  const overdueCount = ['advocate','a','b','c'].reduce((acc, t) => {
    return acc + ((data?.byTier?.[t] || []).filter(c => c.status === 'red').length);
  }, 0);

  // Which contacts to render. Search overrides tabs — when a search query is
  // active we flatten across all tiers + untagged and filter by name/email.
  const isSearching = searchQuery.trim().length > 0;
  let rendered = [];
  if (isSearching) {
    const q = searchQuery.trim().toLowerCase();
    const all = [];
    for (const t of ['advocate', 'a', 'b', 'c']) {
      for (const c of data?.byTier?.[t] || []) all.push(c);
    }
    for (const u of (data?.untieredSample || [])) all.push({ ...u, tier: null, status: 'unknown' });
    // Include "no lead gen" excluded contacts in search results so Jonathan
    // can find and edit them (e.g. remove the tag) without leaving Agent HQ.
    for (const c of (data?.excluded || [])) all.push(c);
    rendered = all.filter(c => {
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    // Best matches first: name-starts-with > name-contains > email-contains
    rendered.sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const aw = an.startsWith(q) ? 0 : an.includes(q) ? 1 : 2;
      const bw = bn.startsWith(q) ? 0 : bn.includes(q) ? 1 : 2;
      if (aw !== bw) return aw - bw;
      return an.localeCompare(bn);
    });
  } else if (tab === 'overdue') {
    for (const t of ['advocate', 'a', 'b', 'c']) {
      for (const c of data?.byTier?.[t] || []) if (c.status === 'red') rendered.push(c);
    }
    rendered.sort((a, b) => b.score - a.score);
  } else if (tab === 'untagged') {
    rendered = (data?.untieredSample || []).map(u => ({ ...u, tier: null, status: 'unknown' }));
  } else {
    rendered = data?.byTier?.[tab] || [];
    if (onlyOverdue) rendered = rendered.filter(c => c.status === 'red');
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCheck size={20} color="#c8a96e" />
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sphere</h2>
          <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
            {counts.uniqueContacts || 0} contacts
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: overdueCount > 0 ? '#991b1b' : '#065f46', fontWeight: 600 }}>
            {overdueCount} overdue
          </span>
          {(counts.excluded || 0) > 0 && (
            <span title='Hidden from Sphere by the "no lead gen" tag — still in FUB, searchable above.' style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6, fontWeight: 600, cursor: 'help' }}>
              {counts.excluded} hidden
            </span>
          )}
          <button onClick={() => load(true)} title="Force-refresh from FUB" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <RotateCw size={12} />Refresh
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={14} color="#9ca3af" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search across all tiers by name or email…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
        />
        {isSearching && (
          <button
            onClick={() => setSearchQuery('')}
            title="Clear search"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Search results count when searching */}
      {isSearching && data && !data.error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
          {rendered.length === 0
            ? <>No matches for <strong>"{searchQuery}"</strong></>
            : <><strong>{rendered.length}</strong> match{rendered.length === 1 ? '' : 'es'} for <strong>"{searchQuery}"</strong> across all tiers</>}
        </div>
      )}

      {/* Tier health strip (hidden during search) */}
      {!isSearching && data && !data.error && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {['advocate','a','b','c'].map(t => {
            const tc = tierColor(t);
            const all = data.byTier?.[t] || [];
            const red = all.filter(c => c.status === 'red').length;
            return (
              <div key={t} onClick={() => setTab(t)} style={{ cursor: 'pointer', border: `1px solid ${tc.border}`, background: tab === t ? tc.bg : '#fff', borderRadius: 10, padding: '8px 12px', minWidth: 120 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: tc.fg, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{all.length}</div>
                <div style={{ fontSize: 11, color: red > 0 ? '#991b1b' : '#6b7280', marginTop: 2 }}>
                  {red > 0 ? `${red} overdue` : 'all on track'}
                </div>
              </div>
            );
          })}
          {counts.untiered > 0 && (
            <div onClick={() => setTab('untagged')} style={{ cursor: 'pointer', border: '1px dashed #f59e0b', background: tab === 'untagged' ? '#fef3c7' : '#fffbeb', borderRadius: 10, padding: '8px 12px', minWidth: 120 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.5 }}>Untagged</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{counts.untiered}+</div>
              <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>need tier tag</div>
            </div>
          )}
        </div>
      )}

      {/* Tab bar (hidden during search) */}
      {!isSearching && <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 14, flexWrap: 'wrap' }}>
        {tierTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? '#c8a96e' : 'transparent',
              color: tab === t.key ? '#fff' : '#374151',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid #c8a96e' : '2px solid transparent',
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '8px 8px 0 0',
            }}
          >
            {t.label}
            {t.key === 'overdue' && overdueCount > 0 && (
              <span style={{ marginLeft: 6, background: '#991b1b', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{overdueCount}</span>
            )}
          </button>
        ))}
        {['advocate','a','b','c'].includes(tab) && (
          <label style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} />
            Show only overdue
          </label>
        )}
      </div>}

      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading sphere contacts from FUB…</div>}
      {data?.error && <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 12 }}>Error: {data.error}</div>}

      {/* Contact list — empty state changes based on context */}
      {!loading && !data?.error && rendered.length === 0 && !isSearching && (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: 10, border: '1px dashed #d1d5db' }}>
          {tab === 'overdue' ? 'Nobody overdue — you\'re on pace.' : 'No contacts in this tab.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {rendered.map(c => {
          const tc = tierColor(c.tier);
          const sc = statusColor(c.status);
          return (
            <div key={c.fubId} style={{ border: '1px solid #ede9fe', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div
                  onClick={() => setEditingFubId(c.fubId)}
                  title="Click to edit contact details"
                  style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {c.name}<PenLine size={11} color="#9ca3af" style={{ opacity: 0.6, flexShrink: 0 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {c.stage || 'No stage'}{c.email ? ` · ${c.email}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {c.tier && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: tc.bg, color: tc.fg, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {c.tier === 'advocate' ? 'Adv' : c.tier.toUpperCase()}
                    </span>
                  )}
                  {c.excluded && (
                    <span title='Hidden from Sphere by the "no lead gen" tag' style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      No Lead Gen
                    </span>
                  )}
                </div>
              </div>

              {c.status && c.status !== 'unknown' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 9 }}>{sc.label}</span>
                  <span style={{ color: '#6b7280' }}>
                    {c.daysSince !== null ? `${c.daysSince}d since last touch` : 'no touch recorded'}
                    {c.cadenceDays ? ` · target ${c.cadenceDays}d` : ''}
                  </span>
                </div>
              )}

              {c.phone && <div style={{ fontSize: 11, color: '#475569' }}>{c.phone}</div>}

              {/* Quick-action toolbar — one tap = open channel + log touch */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                {c.phone && (
                  <button
                    onClick={() => quickLog(c, 'call', `tel:${c.phone}`, 'self')}
                    disabled={busyId?.fubId === c.fubId}
                    title="Call & log"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#1d4ed8', cursor: 'pointer', opacity: busyId?.fubId === c.fubId ? 0.5 : 1 }}
                  >
                    <Phone size={12} />Call
                  </button>
                )}
                {c.phone && (
                  <button
                    onClick={() => quickLog(c, 'text', `sms:${c.phone}`, 'self')}
                    disabled={busyId?.fubId === c.fubId}
                    title="Text & log"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#166534', cursor: 'pointer', opacity: busyId?.fubId === c.fubId ? 0.5 : 1 }}
                  >
                    <MessageCircle size={12} />Text
                  </button>
                )}
                {c.email && (
                  <button
                    onClick={() => quickLog(c, 'email', `https://app.followupboss.com/app/inbox/compose?to=${encodeURIComponent(c.email)}`, 'tab')}
                    disabled={busyId?.fubId === c.fubId}
                    title="Email via FUB & log"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#3730a3', cursor: 'pointer', opacity: busyId?.fubId === c.fubId ? 0.5 : 1 }}
                  >
                    <Mail size={12} />Email
                  </button>
                )}
                <button
                  onClick={() => quickLog(c, 'popby', null, null)}
                  disabled={busyId?.fubId === c.fubId}
                  title="Log an in-person pop-by"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#92400e', cursor: 'pointer', opacity: busyId?.fubId === c.fubId ? 0.5 : 1 }}
                >
                  <Home size={12} />Pop-By
                </button>
                {c.fubUrl && (
                  <a
                    href={c.fubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Follow Up Boss"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#374151', textDecoration: 'none', marginLeft: 'auto' }}
                  >
                    <ExternalLink size={11} />FUB
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data?.generatedAt && !loading && (
        <div style={{ marginTop: 14, fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>
          Fetched from FUB at {new Date(data.generatedAt).toLocaleTimeString()} · {data.cached ? 'cached' : 'fresh'}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, background: '#0f172a', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={14} color="#4ade80" />
          {toast}
        </div>
      )}

      {/* Contact detail drawer */}
      {editingFubId && (
        <SphereContactDrawer
          fubId={editingFubId}
          onClose={() => setEditingFubId(null)}
          onChanged={() => load(true)}
          onToast={(msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SPHERE CONTACT DRAWER
// Slide-in editor for a single FUB contact. Lets you update name/email/phone/
// address/stage/tags/background, plus add a timestamped note. Quick-tier buttons
// (Advocate / A / B / C) handle tag swapping cleanly.
// ─────────────────────────────────────────────
const SPHERE_TIER_TAGS = ['Advocate', 'A', 'B', 'C'];
// Stage quick-pick across the top of the drawer (the 5 Jonathan uses constantly).
// Display label is shortened; the value sent to FUB is the full canonical stage name.
const SPHERE_STAGE_QUICKPICK = [
  { label: 'Active Client', value: 'Active Client' },
  { label: 'A · Hot',       value: 'A - Hot 1-3 Months' },
  { label: 'B · Warm',      value: 'B - Warm 3-6 Months' },
  { label: 'C · Cold',      value: 'C - Cold 6+ Months' },
  { label: 'Past Client',   value: 'Past Client' },
];
const SPHERE_INPUT_STYLE = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' };

function SphereSectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{children}</div>;
}

function SphereContactDrawer({ fubId, onClose, onChanged, onToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contact, setContact] = useState(null);
  const [stages, setStages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [form, setForm] = useState({
    firstName: '', lastName: '',
    email: '', phone: '',
    street: '', city: '', province: 'ON', postal: '',
    background: '',
    stage: '',
    tags: [],
    tagInput: '',
  });

  // Fetch contact + stages
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [r1, r2] = await Promise.all([
          fetch(`/api/sphere/contact/${fubId}`).then(r => r.json()),
          fetch('/api/fub/stages').then(r => r.json()).catch(() => ({ ok: false })),
        ]);
        if (cancelled) return;
        if (!r1.ok) { setError(r1.error || 'Failed to load contact'); return; }
        const c = r1.contact || {};
        setContact(c);
        const e0 = (Array.isArray(c.emails) && c.emails[0]) || {};
        const p0 = (Array.isArray(c.phones) && c.phones[0]) || {};
        const a0 = (Array.isArray(c.addresses) && c.addresses[0]) || {};
        setForm({
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: e0.value || '',
          phone: p0.value || '',
          street: a0.street || '',
          city: a0.city || '',
          province: a0.state || a0.province || 'ON',
          postal: a0.code || a0.postal || a0.postalCode || '',
          background: c.background || '',
          stage: c.stage || '',
          tags: Array.isArray(c.tags) ? [...c.tags] : [],
          tagInput: '',
        });
        if (r2 && r2.ok && Array.isArray(r2.stages)) setStages(r2.stages);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fubId]);

  const setTier = (tier) => {
    setForm(f => {
      const others = f.tags.filter(t => !SPHERE_TIER_TAGS.includes(t));
      // If clicking the active tier, clear it. Otherwise replace.
      return { ...f, tags: f.tags.includes(tier) ? others : [...others, tier] };
    });
  };
  const removeTag = (t) => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== t) }));
  const addTag = () => {
    const t = form.tagInput.trim();
    if (!t) return;
    setForm(f => ({
      ...f,
      tags: f.tags.includes(t) ? f.tags : [...f.tags, t],
      tagInput: '',
    }));
  };

  const save = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      // Reconstruct emails/phones/addresses arrays — preserve everything past index 0
      const emailType = (Array.isArray(contact.emails) && contact.emails[0]?.type) || 'personal';
      const phoneType = (Array.isArray(contact.phones) && contact.phones[0]?.type) || 'mobile';
      const addrType  = (Array.isArray(contact.addresses) && contact.addresses[0]?.type) || 'home';

      const newEmails = form.email
        ? [{ value: form.email, type: emailType, isPrimary: 1 }, ...((contact.emails || []).slice(1))]
        : ((contact.emails || []).slice(1));
      const newPhones = form.phone
        ? [{ value: form.phone, type: phoneType, isPrimary: 1 }, ...((contact.phones || []).slice(1))]
        : ((contact.phones || []).slice(1));
      const haveAddress = form.street || form.city || form.postal;
      const newAddresses = haveAddress
        ? [{
            street: form.street, city: form.city,
            state: form.province, code: form.postal,
            country: (Array.isArray(contact.addresses) && contact.addresses[0]?.country) || 'CA',
            type: addrType,
            isPrimary: 1,
          }, ...((contact.addresses || []).slice(1))]
        : ((contact.addresses || []).slice(1));

      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        emails: newEmails,
        phones: newPhones,
        addresses: newAddresses,
        background: form.background,
        tags: form.tags,
        stage: form.stage,
      };
      const r = await fetch(`/api/sphere/contact/${fubId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        if (onToast) onToast('Changes saved');
        if (onChanged) onChanged();
        // Refresh local state from server response so stale arrays don't linger
        if (j.contact) setContact(j.contact);
      } else {
        if (onToast) onToast(`Save failed: ${j.error || 'unknown'}`);
      }
    } catch (e) {
      if (onToast) onToast(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    const t = noteText.trim();
    if (!t) return;
    setSavingNote(true);
    try {
      const r = await fetch(`/api/sphere/contact/${fubId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: t }),
      });
      const j = await r.json();
      if (j.ok) {
        setNoteText('');
        if (onToast) onToast('Note added to FUB');
      } else {
        if (onToast) onToast(`Note failed: ${j.error || 'unknown'}`);
      }
    } catch (e) {
      if (onToast) onToast(`Note failed: ${e.message}`);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 3000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 95vw)', height: '100%', background: '#fff', overflowY: 'auto', boxShadow: '-10px 0 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
        {/* Header (sticky) */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact details</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? 'Loading…' : (`${form.firstName} ${form.lastName}`.trim() || '(no name)')}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        {loading && <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading contact from FUB…</div>}
        {error && <div style={{ margin: 16, padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 12 }}>Error: {error}</div>}

        {!loading && !error && contact && (
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            {/* Stage quick-pick (top of drawer) — sets the FUB pipeline stage */}
            <div>
              <SphereSectionLabel>Stage (FUB pipeline)</SphereSectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SPHERE_STAGE_QUICKPICK.map(s => {
                  const active = form.stage === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => setForm(f => ({ ...f, stage: f.stage === s.value ? '' : s.value }))}
                      title={s.value}
                      style={{
                        flex: '1 1 auto', padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: active ? '1px solid #c8a96e' : '1px solid #e5e7eb',
                        background: active ? '#c8a96e' : '#fff',
                        color: active ? '#fff' : '#374151',
                        whiteSpace: 'nowrap',
                      }}
                    >{s.label}</button>
                  );
                })}
              </div>
              {form.stage && !SPHERE_STAGE_QUICKPICK.some(s => s.value === form.stage) && (
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setForm(f => ({ ...f, stage: '' }))}
                    title="Custom stage from FUB — click to clear"
                    style={{
                      padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: '1px solid #c8a96e', background: '#c8a96e', color: '#fff',
                    }}
                  >{form.stage} ×</button>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Click again to clear. Tier classification (Advocate/A/B/C) lives in the Tags section below.</div>
            </div>

            {/* Name */}
            <div>
              <SphereSectionLabel>Name</SphereSectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="First" style={SPHERE_INPUT_STYLE} />
                <input value={form.lastName}  onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}  placeholder="Last"  style={SPHERE_INPUT_STYLE} />
              </div>
            </div>

            {/* Email */}
            <div>
              <SphereSectionLabel>Primary email</SphereSectionLabel>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" style={SPHERE_INPUT_STYLE} />
              {Array.isArray(contact.emails) && contact.emails.length > 1 && (
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>+ {contact.emails.length - 1} other email{contact.emails.length > 2 ? 's' : ''} on file (preserved)</div>
              )}
            </div>

            {/* Phone */}
            <div>
              <SphereSectionLabel>Primary phone</SphereSectionLabel>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(705) 555-1234" style={SPHERE_INPUT_STYLE} />
              {Array.isArray(contact.phones) && contact.phones.length > 1 && (
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>+ {contact.phones.length - 1} other phone{contact.phones.length > 2 ? 's' : ''} on file (preserved)</div>
              )}
            </div>

            {/* Address */}
            <div>
              <SphereSectionLabel>Address</SphereSectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} placeholder="Street" style={SPHERE_INPUT_STYLE} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={form.city}     onChange={e => setForm(f => ({ ...f, city: e.target.value }))}     placeholder="City"     style={{ ...SPHERE_INPUT_STYLE, flex: 2 }} />
                  <input value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} placeholder="ON"       style={{ ...SPHERE_INPUT_STYLE, flex: 0, width: 60 }} />
                  <input value={form.postal}   onChange={e => setForm(f => ({ ...f, postal: e.target.value }))}   placeholder="L4R 1A1"  style={{ ...SPHERE_INPUT_STYLE, flex: 0, width: 110 }} />
                </div>
              </div>
            </div>


            {/* Tags */}
            <div>
              <SphereSectionLabel>Tags</SphereSectionLabel>
              {form.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {form.tags.map(t => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: SPHERE_TIER_TAGS.includes(t) ? '#fef3c7' : '#eef2ff', color: SPHERE_TIER_TAGS.includes(t) ? '#92400e' : '#3730a3', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>
                      {t}
                      <button onClick={() => removeTag(t)} title="Remove tag" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontSize: 14, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={form.tagInput}
                  onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Add a tag and press Enter"
                  style={SPHERE_INPUT_STYLE}
                />
                <button onClick={addTag} style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add</button>
              </div>
            </div>

            {/* Background */}
            <div>
              <SphereSectionLabel>Background (personal details)</SphereSectionLabel>
              <textarea
                value={form.background}
                onChange={e => setForm(f => ({ ...f, background: e.target.value }))}
                placeholder="Spouse Sarah; kids Mason (12) & Olivia (10); home anniv June 15; loves golf at Brooklea; works at Honda Alliston…"
                style={{ ...SPHERE_INPUT_STYLE, minHeight: 86, resize: 'vertical' }}
              />
            </div>

            {/* Save changes */}
            <button
              onClick={save}
              disabled={saving}
              style={{ background: '#c8a96e', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>

            {/* Add a note (separate action — does NOT count as a touch) */}
            <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
              <SphereSectionLabel>Add a note (timeline only — not a touch)</SphereSectionLabel>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Quick note saved to FUB timeline. Use this for things like 'mentioned planning a kitchen reno' — does NOT reset the cadence clock."
                style={{ ...SPHERE_INPUT_STYLE, minHeight: 60, resize: 'vertical' }}
              />
              <button
                onClick={addNote}
                disabled={savingNote || !noteText.trim()}
                style={{ marginTop: 6, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: (savingNote || !noteText.trim()) ? 'not-allowed' : 'pointer', opacity: (savingNote || !noteText.trim()) ? 0.4 : 1 }}
              >
                {savingNote ? 'Adding…' : 'Add note to FUB'}
              </button>
            </div>

            {/* Footer link to full FUB record */}
            <div style={{ textAlign: 'center', paddingBottom: 14 }}>
              <a href={`https://app.followupboss.com/2/people/view/${fubId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#6b7280', textDecoration: 'underline' }}>
                Open full record in Follow Up Boss →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RUN COMPS / CMA SECTION
// ─────────────────────────────────────────────
function RunCompsSection() {
  const [cmas, setCmas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/cma');
      const j = await r.json();
      if (j.ok) setCmas(j.cmas || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const statusColor = (s) => {
    if (s === 'ready') return { bg: '#dcfce7', fg: '#166534' };
    if (s === 'running') return { bg: '#dbeafe', fg: '#1e40af' };
    if (s === 'pending') return { bg: '#fef3c7', fg: '#92400e' };
    if (s === 'error') return { bg: '#fee2e2', fg: '#991b1b' };
    return { bg: '#f3f4f6', fg: '#374151' };
  };
  const timeAgo = (iso) => {
    if (!iso) return '—';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
  const money = (n) => n ? '$' + Number(n).toLocaleString() : '—';

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={20} color="#c8a96e" />
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>CMA</h2>
          <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
            {cmas.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} title="Reload" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <RotateCw size={12} />Reload
          </button>
          <button onClick={() => setIntakeOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            <Plus size={12} />New CMA
          </button>
        </div>
      </div>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: '#4b5563', lineHeight: 1.55 }}>
        <strong style={{ color: '#111827' }}>To run a new CMA:</strong> click <em>New CMA</em>, fill the subject details, submit. Then say <em>"run my pending CMAs"</em> to Claude — it'll drive REALM to pull comps + history + photos, generate the AI pricing narrative, and post back here. When ready, click <em>Print PDF</em> for a 4-page client-ready document.
      </div>

      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading…</div>}

      {!loading && !cmas.length && (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: 10, border: '1px dashed #d1d5db' }}>
          No CMAs yet. Click <strong>New CMA</strong> to create one.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cmas.map(c => {
          const sc = statusColor(c.status);
          return (
            <div key={c.id} onClick={() => setDetailId(c.id)} style={{ cursor: 'pointer', border: '1px solid #ede9fe', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{c.address}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {c.city}{c.mlsId ? ` · MLS ${c.mlsId}` : ''} · Created {timeAgo(c.createdAt)}{c.ranAt ? ` · Ran ${timeAgo(c.ranAt)}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {c.priceRange?.mid ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#c8a96e' }}>{money(c.priceRange.mid)}</div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{money(c.priceRange.low)} – {money(c.priceRange.high)}</div>
                  </div>
                ) : c.listPrice ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#c8a96e' }}>{money(c.listPrice)}</div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>listed</div>
                  </div>
                ) : null}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: sc.bg, color: sc.fg, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{c.status}</span>
            </div>
          );
        })}
      </div>

      {intakeOpen && <CmaIntakeModal onClose={() => setIntakeOpen(false)} onCreated={(cma) => { setIntakeOpen(false); setDetailId(cma.id); load(); }} />}
      {detailId && <CmaDetailModal id={detailId} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

// Module-scope so React keeps the same component reference across re-renders
// (defining this inside CmaIntakeModal would unmount/remount the input on every
// keystroke and kill focus — classic "one letter at a time" bug).
function CmaField({ label, k, type = 'text', placeholder, required, options, form, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {type === 'select' ? (
        <select value={form[k]} onChange={e => set(k, e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === 'checkbox' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}>
          <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} /> Yes
        </label>
      ) : (
        <input type={type} value={form[k]} onChange={e => set(k, e.target.value)} placeholder={placeholder || ''} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }} />
      )}
    </div>
  );
}

// CMA: parsed-field mapper — translates PDF parser output → CMA intake form keys.
function mergeParsedIntoCmaForm(form, parsed) {
  const merged = { ...form };
  const passThrough = ['address', 'city', 'province', 'mlsId', 'bedrooms', 'bathrooms', 'sqft', 'lotSize', 'propertyClass', 'style', 'foundation', 'garage'];
  for (const k of passThrough) {
    if (parsed[k] != null && parsed[k] !== '') merged[k] = String(parsed[k]);
  }
  if (parsed.listPrice != null) merged.listPrice = String(parsed.listPrice);
  if (parsed.yearBuilt != null) merged.yearBuilt = String(parsed.yearBuilt);
  if (parsed.waterfront != null) merged.waterfront = !!parsed.waterfront;
  return merged;
}

// CMA: extract comp-relevant subset from parsed PDF fields. Drops the
// soft narrative fields the comps list doesn't need.
function compFromParsedFields(fields) {
  return {
    address: fields.address || '',
    city: fields.city || '',
    mlsId: fields.mlsId || '',
    listPrice: fields.listPrice || null,
    soldPrice: fields.soldPrice || null,
    listedDate: fields.listedDate || '',
    soldDate: fields.soldDate || '',
    daysOnMarket: fields.daysOnMarket || null,
    bedrooms: fields.bedrooms || '',
    bathrooms: fields.bathrooms || '',
    sqft: fields.sqft || '',
    lotSize: fields.lotSize || '',
    yearBuilt: fields.yearBuilt || null,
    style: fields.style || '',
    propertyClass: fields.propertyClass || '',
    foundation: fields.foundation || '',
    garage: fields.garage || '',
    waterfront: !!fields.waterfront,
    publicRemarks: fields.publicRemarks || '',
    features: fields.features || '',
  };
}

// CMA: drag/drop or click-to-browse drop zone for REALM listing PDFs.
// Accepts multiple files. Calls onParsed(fields, meta) once per parsed PDF.
function CmaPdfDropZone({ onParsed, allowMore = true }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  async function uploadFiles(filesList) {
    const files = Array.from(filesList || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) {
      setStatus({ ok: false, msg: 'Please drop one or more PDFs (.pdf).' });
      return;
    }
    setBusy(true);
    setStatus(null);
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus({ ok: true, msg: `Parsing ${i + 1} of ${files.length} — ${file.name}...` });
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/cma/parse-pdf', { method: 'POST', body: fd });
        const j = await r.json();
        if (j.ok) {
          onParsed(j.fields, j.meta);
          ok++;
        } else {
          fail++;
        }
      } catch (e) {
        fail++;
      }
    }
    setBusy(false);
    setStatus({
      ok: ok > 0,
      msg: `Parsed ${ok} of ${files.length} PDF(s)${fail ? ` — ${fail} failed` : ''}. First becomes the subject; rest are pending comps below.`,
    });
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: '2px dashed ' + (drag ? '#c8a96e' : '#d4b878'),
          background: drag ? '#fef3c7' : '#fffbeb',
          borderRadius: 10, padding: 16,
          textAlign: 'center', cursor: 'pointer', transition: 'all 0.1s',
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,application/pdf" hidden onChange={e => uploadFiles(e.target.files)} />
        {busy ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#92400e', fontSize: 12 }}>
            <Loader2 size={14} className="spin" /> Parsing — regex + AI extraction...
          </div>
        ) : (
          <div>
            <UploadCloud size={22} color="#c8a96e" style={{ margin: '0 auto 4px', display: 'block' }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>Drop REALM listing PDFs to autofill</div>
            <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>
              {allowMore ? 'First fills subject · rest become pending comps · ' : 'Add more comps · '}
              click or drop multiple at once · max 25 MB each
            </div>
          </div>
        )}
      </div>
      {status && (
        <div style={{
          marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 11,
          background: status.ok ? '#dcfce7' : '#fee2e2',
          color: status.ok ? '#166534' : '#991b1b',
        }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

// CMA: pending-comps tile list shown below the drop zone in the intake modal.
function CmaPendingCompsList({ comps, onSetRole, onRemove }) {
  if (!comps.length) return null;
  return (
    <div style={{ marginBottom: 16, padding: 10, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
        Pending comps ({comps.length}) · will attach on Create
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {comps.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', background: '#fff', borderRadius: 8, border: '1px solid #fde68a',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.fields.address || '(no address)'}{c.fields.city ? `, ${c.fields.city}` : ''}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>
                {c.fields.mlsId ? `MLS ${c.fields.mlsId} · ` : ''}
                {c.fields.soldPrice ? `Sold $${Number(c.fields.soldPrice).toLocaleString()}` :
                 c.fields.listPrice ? `Listed $${Number(c.fields.listPrice).toLocaleString()}` : '—'}
                {c.fields.bedrooms ? ` · ${c.fields.bedrooms} bed` : ''}
                {c.fields.bathrooms ? ` · ${c.fields.bathrooms} bath` : ''}
                {c.fields.sqft ? ` · ${c.fields.sqft} sqft` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => onSetRole(c.id, 'sold')} style={{
                fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 4,
                border: 'none', cursor: 'pointer',
                background: c.role === 'sold' ? '#166534' : '#f3f4f6',
                color: c.role === 'sold' ? '#fff' : '#6b7280',
              }}>SOLD</button>
              <button onClick={() => onSetRole(c.id, 'active')} style={{
                fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 4,
                border: 'none', cursor: 'pointer',
                background: c.role === 'active' ? '#1e40af' : '#f3f4f6',
                color: c.role === 'active' ? '#fff' : '#6b7280',
              }}>ACTIVE</button>
              <button onClick={() => onRemove(c.id)} title="Remove" style={{
                background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4,
              }}><X size={12} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CmaIntakeModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    address: '', city: 'Midland', province: 'ON',
    bedrooms: '', bathrooms: '', sqft: '', lotSize: '',
    style: '', yearBuilt: '', foundation: '', garage: '',
    waterfront: false, propertyClass: 'Freehold', mlsId: '',
    listPrice: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [pendingComps, setPendingComps] = useState([]); // [{ id, role: 'sold'|'active', fields, meta }]

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Route parsed PDFs: first one (or any while form is empty) fills subject,
  // rest become pending comps defaulted to "sold."
  function handleParsed(fields, meta) {
    setForm(prev => {
      if (!prev.address && !prev.mlsId) {
        return mergeParsedIntoCmaForm(prev, fields);
      }
      // Form already has a subject — push to pending comps
      setPendingComps(p => [...p, {
        id: `pc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        role: 'sold',
        fields, meta,
      }]);
      return prev;
    });
  }
  const setCompRole = (id, role) => setPendingComps(prev => prev.map(c => c.id === id ? { ...c, role } : c));
  const removeComp = (id) => setPendingComps(prev => prev.filter(c => c.id !== id));

  const submit = async () => {
    if (!form.address || !form.city) { alert('Address and city required'); return; }
    setSubmitting(true);
    try {
      const body = {
        ...form,
        listPrice: form.listPrice ? Number(form.listPrice.replace(/[^0-9]/g, '')) : null,
        pendingSolds:   pendingComps.filter(c => c.role === 'sold').map(c => compFromParsedFields(c.fields)),
        pendingActives: pendingComps.filter(c => c.role === 'active').map(c => compFromParsedFields(c.fields)),
      };
      const r = await fetch('/api/cma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.ok) onCreated(j.cma);
      else alert('Error: ' + (j.error || 'unknown'));
    } catch (e) { alert(e.message); }
    setSubmitting(false);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>New CMA</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Fill required fields. Optional fields sharpen the match — use any you know.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 12, padding: 10, background: '#eef2ff', borderRadius: 8, fontSize: 11, color: '#3730a3' }}>
          <strong>Shortcut:</strong> paste an MLS # and the skill will fetch all attributes from REALM. Otherwise fill the fields manually.
        </div>

        <CmaPdfDropZone onParsed={handleParsed} allowMore={!!form.address || !!form.mlsId} />
        <CmaPendingCompsList comps={pendingComps} onSetRole={setCompRole} onRemove={removeComp} />

        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 8px' }}>Required</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
          <CmaField label="Address" k="address" placeholder="123 Main St" required form={form} set={set} />
          <CmaField label="City" k="city" required form={form} set={set} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          <CmaField label="Bedrooms" k="bedrooms" placeholder="3+1" form={form} set={set} />
          <CmaField label="Bathrooms" k="bathrooms" placeholder="2" form={form} set={set} />
          <CmaField label="Sqft" k="sqft" placeholder="1100-1500" form={form} set={set} />
          <CmaField label="Lot Size" k="lotSize" placeholder="60 x 120 ft" form={form} set={set} />
        </div>

        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, margin: '16px 0 8px' }}>Optional — Sharpen the Comps</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <CmaField label="MLS # (if any)" k="mlsId" placeholder="S12345678" form={form} set={set} />
          <CmaField label="Property Class" k="propertyClass" type="select" options={['Freehold', 'Condo', 'Commercial']} form={form} set={set} />
          <CmaField label="Current List Price" k="listPrice" placeholder="529000" form={form} set={set} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <CmaField label="Style" k="style" placeholder="Bungalow / 2-Storey / Sidesplit" form={form} set={set} />
          <CmaField label="Year Built" k="yearBuilt" placeholder="1958" form={form} set={set} />
          <CmaField label="Foundation" k="foundation" placeholder="Concrete Block / Stone / Poured" form={form} set={set} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <CmaField label="Garage" k="garage" placeholder="Attached single / Double detached / None" form={form} set={set} />
          <CmaField label="Waterfront?" k="waterfront" type="checkbox" form={form} set={set} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={{ background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {submitting ? 'Creating…' : 'Create CMA'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CmaDetailModal({ id, onClose }) {
  const [cma, setCma] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addCompKind, setAddCompKind] = useState(null); // 'sold' | 'active' | null
  const [compDraft, setCompDraft] = useState({});
  const [copiedRun, setCopiedRun] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/cma/${id}`);
      const j = await r.json();
      if (j.ok) { setCma(j.cma); setDraft({}); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const money = (n) => n ? '$' + Number(n).toLocaleString() : '—';

  const patch = async (body) => {
    try {
      const r = await fetch(`/api/cma/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.ok) setCma(j.cma);
    } catch (e) { alert(e.message); }
  };

  const removeComp = (compId) => patch({ removeCompId: compId });

  const del = async () => {
    if (!window.confirm('Delete this CMA?')) return;
    await fetch(`/api/cma/${id}`, { method: 'DELETE' });
    onClose();
  };

  if (loading || !cma) return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 40, color: '#6b7280' }}>Loading…</div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 960, width: '100%', maxHeight: '92vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{cma.address}</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              {cma.city}, {cma.province}{cma.mlsId ? ` · MLS ${cma.mlsId}` : ''} · Status: <strong style={{ color: '#374151' }}>{cma.status}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a href={`/cma/${cma.id}/print`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', background: '#c8a96e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <FileText size={12} />Print PDF
            </a>
            <button onClick={del} style={{ background: 'transparent', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }}>Delete</button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
          </div>
        </div>

        {/* Subject Summary — every field is inline-editable on click; auto-saves on blur or Enter */}
        <SubjectPropertyEditor cma={cma} onPatch={patch} />


        {/* Pending banner with run prompt */}
        {cma.status === 'pending' && (
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#78350f' }}>
              <strong>Pending.</strong> To have Claude execute this CMA (drive REALM, pull comps, generate pricing), copy the prompt and paste into this chat.
            </div>
            <button onClick={async () => {
              try {
                await navigator.clipboard.writeText(`run my pending CMAs`);
                setCopiedRun(true);
                setTimeout(() => setCopiedRun(false), 2000);
              } catch { alert('Clipboard blocked — copy "run my pending CMAs" manually'); }
            }} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'linear-gradient(135deg,#c8a96e,#d4b878)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {copiedRun ? <><Check size={11} />Copied</> : <>Copy "run my pending CMAs"</>}
            </button>
          </div>
        )}

        {/* Price Range — interactive slider */}
        {cma.priceRange?.mid && (
          <PriceRangeSlider cma={cma} onPatch={patch} />
        )}

        {/* Comp lists */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.4 }}>Recent Solds ({cma.comps?.solds?.length || 0})</div>
              <button onClick={() => { setAddCompKind('sold'); setCompDraft({}); }} style={{ fontSize: 10, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }}>+ Add</button>
            </div>
            {(cma.comps?.solds || []).map((s, i) => (
              <div key={s.id || i} style={{ padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{s.address}</div>
                  <div style={{ color: '#475569' }}>{s.price} · {s.beds}/{s.baths} · {s.sqft} · {s.style} · {s.dom} DOM · sold {s.soldDate}</div>
                </div>
                <button onClick={() => removeComp(s.id)} title="Remove" style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer' }}><X size={12} /></button>
              </div>
            ))}
            {!cma.comps?.solds?.length && <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', padding: 8 }}>No sold comps yet. Ask Claude to "run my pending CMAs" or click + Add.</div>}
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.4 }}>Current Actives ({cma.comps?.actives?.length || 0})</div>
              <button onClick={() => { setAddCompKind('active'); setCompDraft({}); }} style={{ fontSize: 10, background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }}>+ Add</button>
            </div>
            {(cma.comps?.actives || []).map((a, i) => (
              <div key={a.id || i} style={{ padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{a.address}</div>
                  <div style={{ color: '#475569' }}>{a.price} · {a.beds}/{a.baths} · {a.sqft} · {a.style} · {a.dom} DOM {a.status ? `· ${a.status}` : ''}</div>
                </div>
                <button onClick={() => removeComp(a.id)} title="Remove" style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer' }}><X size={12} /></button>
              </div>
            ))}
            {!cma.comps?.actives?.length && <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', padding: 8 }}>No actives yet.</div>}
          </div>
        </div>

        {/* Add Comp form */}
        {addCompKind && (
          <AddCompForm kind={addCompKind} onCancel={() => setAddCompKind(null)} onAdd={async (data) => {
            await patch({ addComp: { kind: addCompKind, data } });
            setAddCompKind(null);
          }} />
        )}

        {/* Pricing narrative */}
        {cma.pricingNarrative && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Pricing Analysis</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#1f2937', background: '#fafafa', padding: 12, borderRadius: 8 }}>{cma.pricingNarrative}</div>
          </div>
        )}

        {/* Seller update */}
        {cma.sellerUpdate && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Seller Update Draft</div>
            <textarea value={cma.sellerUpdate} onChange={e => patch({ sellerUpdate: e.target.value })} style={{ width: '100%', minHeight: 80, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        )}

        {/* Notes */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Notes</div>
          <textarea value={cma.notes || ''} onChange={e => patch({ notes: e.target.value })} placeholder="Anything worth capturing — seller motivation, deferred maintenance, timing preferences, showing feedback, etc." style={{ width: '100%', minHeight: 100, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
      </div>
    </div>
  );
}

// Inline-editable Subject Property tile. Click any field to edit; auto-saves
// on blur or Enter. Esc cancels. Used in the CMA detail modal so Jonathan can
// fix sqft / year / foundation / etc. without going through the intake form again.
function SubjectPropertyEditor({ cma, onPatch }) {
  const fields = [
    { k: 'style',       label: 'Style',       type: 'text',     placeholder: 'Bungalow / 1.5 Storey / 2-Storey…' },
    { k: 'bedrooms',    label: 'Beds',        type: 'text',     placeholder: 'e.g. 3 or 2+1' },
    { k: 'bathrooms',   label: 'Baths',       type: 'text',     placeholder: 'e.g. 2' },
    { k: 'sqft',        label: 'Sqft',        type: 'text',     placeholder: 'e.g. 1100-1500' },
    { k: 'lotSize',     label: 'Lot',         type: 'text',     placeholder: 'e.g. 60 x 150' },
    { k: 'yearBuilt',   label: 'Year built',  type: 'text',     placeholder: 'e.g. 1985' },
    { k: 'foundation',  label: 'Foundation',  type: 'text',     placeholder: 'Poured / Block / Stone' },
    { k: 'garage',      label: 'Garage',      type: 'text',     placeholder: 'None / Single / Double' },
    { k: 'waterfront',  label: 'Waterfront',  type: 'select',   options: [['', '—'], ['true', 'Yes'], ['false', 'No']] },
    { k: 'listPrice',   label: 'List price',  type: 'money',    placeholder: '525000' },
  ];

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Subject Property</div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>Click any field to edit</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {fields.map(f => (
          <SubjectField
            key={f.k}
            label={f.label}
            value={cma[f.k]}
            type={f.type}
            placeholder={f.placeholder}
            options={f.options}
            onSave={(v) => {
              if (f.type === 'money') {
                const n = v ? Number(String(v).replace(/[^0-9.]/g, '')) : null;
                onPatch({ [f.k]: n || null });
              } else if (f.type === 'select' && f.k === 'waterfront') {
                onPatch({ waterfront: v === 'true' });
              } else {
                onPatch({ [f.k]: v });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SubjectField({ label, value, type, placeholder, options, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const fmtMoney = (n) => (n || n === 0) ? '$' + Number(n).toLocaleString() : '—';
  const display = type === 'money'
    ? fmtMoney(value)
    : type === 'select' && options
      ? (options.find(o => String(o[0]) === String(value))?.[1] ?? (value === true ? 'Yes' : value === false ? 'No' : '—'))
      : (value || value === 0 ? String(value) : '—');

  const startEdit = () => {
    setDraft(type === 'select' ? (value === true ? 'true' : value === false ? 'false' : '') : (value ?? ''));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onSave(draft);
  };
  const cancel = () => setEditing(false);

  return (
    <div style={{ fontSize: 12, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>{label}</div>
      {editing ? (
        type === 'select' ? (
          <select
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            style={{ width: '100%', padding: '4px 6px', border: '1px solid #c8a96e', borderRadius: 4, fontSize: 12, background: '#fff' }}
          >
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ) : (
          <input
            autoFocus
            type={type === 'money' ? 'text' : 'text'}
            value={draft}
            placeholder={placeholder}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
            style={{ width: '100%', padding: '4px 6px', border: '1px solid #c8a96e', borderRadius: 4, fontSize: 12, fontFamily: 'inherit' }}
          />
        )
      ) : (
        <div
          onClick={startEdit}
          title="Click to edit"
          style={{ cursor: 'pointer', padding: '4px 6px', borderRadius: 4, border: '1px solid transparent', color: (value === undefined || value === null || value === '') ? '#9ca3af' : '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          {display}
        </div>
      )}
    </div>
  );
}

function PriceRangeSlider({ cma, onPatch }) {
  const { low, mid, high } = cma.priceRange || {};
  // Compute slider min/max from comp prices + current range
  const compPrices = [...(cma.comps?.solds || []), ...(cma.comps?.actives || [])]
    .map(c => {
      if (c.priceNumeric) return c.priceNumeric;
      const m = String(c.price || '').match(/\$?([\d,.]+)([KM])?/);
      if (!m) return 0;
      const v = parseFloat(m[1].replace(/,/g, ''));
      return m[2] === 'M' ? v * 1_000_000 : m[2] === 'K' ? v * 1000 : v;
    })
    .filter(n => n > 0);
  const allRefs = [...compPrices, low, high, mid, cma.listPrice].filter(Boolean);
  const sliderMin = allRefs.length ? Math.floor(Math.min(...allRefs) * 0.85 / 5000) * 5000 : 300000;
  const sliderMax = allRefs.length ? Math.ceil(Math.max(...allRefs) * 1.15 / 5000) * 5000 : 1500000;
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : '—';

  const [dragLow, setDragLow] = useState(low || sliderMin);
  const [dragMid, setDragMid] = useState(mid || (low + high) / 2 || (sliderMin + sliderMax) / 2);
  const [dragHigh, setDragHigh] = useState(high || sliderMax);
  const [dragDom, setDragDom] = useState(cma.estimatedDom || 30);

  useEffect(() => {
    setDragLow(low || sliderMin);
    setDragMid(mid || (sliderMin + sliderMax) / 2);
    setDragHigh(high || sliderMax);
    setDragDom(cma.estimatedDom || 30);
  }, [low, mid, high, cma.estimatedDom, sliderMin, sliderMax]);

  const commit = () => {
    onPatch({ priceRange: { low: dragLow, mid: dragMid, high: dragHigh }, estimatedDom: dragDom });
  };

  const lowPct = ((dragLow - sliderMin) / (sliderMax - sliderMin)) * 100;
  const midPct = ((dragMid - sliderMin) / (sliderMax - sliderMin)) * 100;
  const highPct = ((dragHigh - sliderMin) / (sliderMax - sliderMin)) * 100;

  return (
    <div style={{ background: 'linear-gradient(135deg,#fef3c7,#fefce8)', border: '1px solid #fde68a', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Estimated Sale Price Range — drag the handles</div>

      {/* Labels row showing the 3 current values */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14, textAlign: 'center' }}>
        <div><div style={{ fontSize: 10, color: '#92400e', textTransform: 'uppercase' }}>Low</div><div style={{ fontSize: 18, fontWeight: 700, color: '#78350f' }}>{fmt(dragLow)}</div></div>
        <div><div style={{ fontSize: 10, color: '#92400e', textTransform: 'uppercase' }}>Most Likely</div><div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{fmt(dragMid)}</div></div>
        <div><div style={{ fontSize: 10, color: '#92400e', textTransform: 'uppercase' }}>High</div><div style={{ fontSize: 18, fontWeight: 700, color: '#78350f' }}>{fmt(dragHigh)}</div></div>
      </div>

      {/* Dual slider track with 3 handles */}
      <div style={{ position: 'relative', height: 48, marginBottom: 8 }}>
        {/* base track */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 22, height: 4, background: '#fde68a', borderRadius: 2 }} />
        {/* range band (low to high) */}
        <div style={{ position: 'absolute', left: `${lowPct}%`, width: `${highPct - lowPct}%`, top: 22, height: 4, background: '#c8a96e', borderRadius: 2 }} />
        {/* Mid indicator line */}
        <div style={{ position: 'absolute', left: `calc(${midPct}% - 2px)`, top: 12, width: 4, height: 24, background: '#0f172a', borderRadius: 2 }} />
        {/* 3 range inputs stacked and interleaved */}
        <input type="range" min={sliderMin} max={sliderMax} step="1000" value={dragLow} onChange={e => { const v = Math.min(Number(e.target.value), dragMid); setDragLow(v); }} onMouseUp={commit} onTouchEnd={commit}
          style={{ position: 'absolute', left: 0, right: 0, top: 16, width: '100%', appearance: 'none', background: 'transparent', pointerEvents: 'auto', zIndex: 3 }} />
        <input type="range" min={sliderMin} max={sliderMax} step="1000" value={dragMid} onChange={e => { const v = Math.max(dragLow, Math.min(Number(e.target.value), dragHigh)); setDragMid(v); }} onMouseUp={commit} onTouchEnd={commit}
          style={{ position: 'absolute', left: 0, right: 0, top: 16, width: '100%', appearance: 'none', background: 'transparent', pointerEvents: 'auto', zIndex: 4 }} />
        <input type="range" min={sliderMin} max={sliderMax} step="1000" value={dragHigh} onChange={e => { const v = Math.max(Number(e.target.value), dragMid); setDragHigh(v); }} onMouseUp={commit} onTouchEnd={commit}
          style={{ position: 'absolute', left: 0, right: 0, top: 16, width: '100%', appearance: 'none', background: 'transparent', pointerEvents: 'auto', zIndex: 3 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#92400e' }}>
        <span>{fmt(sliderMin)}</span>
        <span>{fmt(sliderMax)}</span>
      </div>

      {/* DOM row */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: 0.4 }}>Est. DOM:</span>
        <input type="range" min="3" max="180" value={dragDom} onChange={e => setDragDom(Number(e.target.value))} onMouseUp={commit} onTouchEnd={commit} style={{ flex: 1 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', minWidth: 50, textAlign: 'right' }}>{dragDom} days</span>
      </div>
    </div>
  );
}

function AddCompForm({ kind, onCancel, onAdd }) {
  const [d, setD] = useState({ address: '', price: '', beds: '', baths: '', sqft: '', style: '', dom: '', soldDate: '', status: '', priceChange: '' });
  const submit = () => {
    if (!d.address || !d.price) { alert('Address and price required'); return; }
    onAdd(d);
  };
  const isSold = kind === 'sold';
  return (
    <div style={{ background: isSold ? '#f0fdf4' : '#eff6ff', border: `1px solid ${isSold ? '#bbf7d0' : '#bfdbfe'}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: isSold ? '#166534' : '#1e40af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>Add {isSold ? 'Sold' : 'Active'} Comp</div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
        <input placeholder="Address" value={d.address} onChange={e => setD({ ...d, address: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        <input placeholder="Price ($529K)" value={d.price} onChange={e => setD({ ...d, price: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        <input placeholder="Beds" value={d.beds} onChange={e => setD({ ...d, beds: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        <input placeholder="Baths" value={d.baths} onChange={e => setD({ ...d, baths: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        <input placeholder="Sqft" value={d.sqft} onChange={e => setD({ ...d, sqft: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        <input placeholder="DOM" value={d.dom} onChange={e => setD({ ...d, dom: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 6 }}>
        <input placeholder="Style (e.g. Bungalow)" value={d.style} onChange={e => setD({ ...d, style: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
        {isSold ? (
          <>
            <input placeholder="Sold date (MM/DD/YYYY)" value={d.soldDate} onChange={e => setD({ ...d, soldDate: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
            <input placeholder="Price change (-$15K)" value={d.priceChange} onChange={e => setD({ ...d, priceChange: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }} />
          </>
        ) : (
          <>
            <select value={d.status} onChange={e => setD({ ...d, status: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 11 }}>
              <option value="">Status</option>
              <option value="Active">Active</option>
              <option value="SC">Sold Conditional</option>
              <option value="Price Change">Price Change</option>
            </select>
            <div />
          </>
        )}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#6b7280' }}>Cancel</button>
          <button onClick={submit} style={{ background: isSold ? '#166534' : '#1e40af', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Add</button>
        </div>
      </div>
    </div>
  );
}

function SectionContent({ section }) {
  switch (section) {
    case "briefing": return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Claude stuck ticker — needs Jonathan's input */}
        <ClaudeStuckTicker />
        {/* Outstanding feedback bar */}
        <OutstandingFeedbackBar />
        {/* Big 3 + Calendar row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TopPriorities />
          <CalendarSection />
        </div>
        {/* Call List + Emails row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <CallListSection />
          <EmailEASection />
        </div>
      </div>
    );
    case "jacqui": return <Jacqui />;
    case "priorities": return <TopPriorities />;
    case "calls": return <CallListSection />;
    case "emails": return (<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><EmailEASection /><GmailActivityPanel /></div>);
    case "calendar": return <CalendarSection />;
    case "showings": return <ShowingsSection />;
    case "crm": return <PlaceholderSection title="Follow Up Boss — Deal Pipeline" icon={Users} />;
    case "sphere": return <SphereSection />;
    case "tj-import": return <TeamJordanImport />;
    case "leadgen": return <PlaceholderSection title="Lead Gen" icon={Target} />;
    case "pnl": return <PnlSection />;
    case "personal": return <PlaceholderSection title="Personal" icon={User} />;
    case "workout": return <PlaceholderSection title="Workout" icon={Dumbbell} />;
    case "meals": return <PlaceholderSection title="Meals" icon={UtensilsCrossed} />;
    case "marketing": return <MarketingSection />;
    case "learning": return <PlaceholderSection title="Learning" icon={BookOpen} />;
    case "active-listings": return <ActiveListingsSection />;
    case "run-comps": return <RunCompsSection />;
    case "aps-parser": return <ApsParser />;
    case "listing-form": return <ListingForm />;
    case "sellers": return <SellersSection />;
    case "loo": return <PlaceholderSection title="LOO" icon={FileText} />;
    case "syncs": return <SyncsSection />;
    case "lifetime": return <LifetimeStats />;
    default: return <PlaceholderSection title={section} icon={FileText} />;
  }
}

// ─────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────
export default function Dashboard() {
  const [section, setSection] = useState("briefing");
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('agenthq-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [sidebarOrder, setSidebarOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('agenthq-sidebar-order');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          // Append any new sidebar items not in saved order
          const allIds = sidebarItems.map(i => i.id);
          const missing = allIds.filter(id => !parsed.includes(id));
          return [...parsed.filter(id => allIds.includes(id)), ...missing];
        }
      }
    } catch {}
    return sidebarItems.map(i => i.id);
  });
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // FUB call list — shared via context
  const fubData = useFubCallList();

  // EA email triage + stuck ticker — shared via context
  const eaEmail = useEaEmailTriage();
  const eaStuck = useEaStuckTicker();
  const eaData = { ...eaEmail, stuck: eaStuck };

  const orderedSidebar = sidebarOrder.map(id => sidebarItems.find(i => i.id === id)).filter(Boolean);

  const handleDragStart = (e, idx) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };
  const handleDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const updated = [...sidebarOrder];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(dropIdx, 0, moved);
    setSidebarOrder(updated);
    try { localStorage.setItem('agenthq-sidebar-order', JSON.stringify(updated)); } catch {}
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <FubContext.Provider value={fubData}>
    <EaContext.Provider value={eaData}>
    <div style={{ display: "flex", height: "100vh", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: "#f3f4f6", overflow: "hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width: collapsed ? 64 : 210, background: "#111827", display: "flex", flexDirection: "column", transition: "width 0.2s", flexShrink: 0, overflow: "hidden" }}>
        <div style={{ padding: collapsed ? "16px 12px" : "16px 16px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem('agenthq-sidebar-collapsed', String(next)); } catch {} }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#c8a96e,#d4b878)", display: "flex", alignItems: "center", justifyContent: "center", color: "#111827", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>JW</div>
          {!collapsed && <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>Jonathan Wallace</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Georgian Bay Realty</div>
          </div>}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 6px" }}>
          {orderedSidebar.map((item, idx) => {
            const Icon = item.icon;
            const active = section === item.id;
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;
            return (
              <div key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, idx)}
                onClick={() => setSection(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: collapsed ? 0 : 6, padding: collapsed ? "9px 12px" : "9px 8px 9px 12px",
                  borderRadius: 8, cursor: "grab", background: active ? "#1f2937" : "transparent",
                  marginBottom: 1, position: "relative",
                  opacity: isDragging ? 0.4 : 1,
                  borderTop: isDragOver ? "2px solid #c8a96e" : "2px solid transparent",
                  transition: "border-top 0.15s ease",
                }}>
                {active && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 18, borderRadius: "0 3px 3px 0", background: "#c8a96e" }} />}
                {!collapsed && <GripVertical size={12} color={isDragging ? "#c8a96e" : "#374151"} style={{ flexShrink: 0, cursor: "grab" }} />}
                <Icon size={16} color={active ? "#c8a96e" : "#6b7280"} strokeWidth={active ? 2.2 : 1.8} style={{ flexShrink: 0 }} />
                {!collapsed && <>
                  <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? "#fff" : "#9ca3af", flex: 1 }}>{item.label}</span>
                  {item.badge && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: active ? "#c8a96e" : "#374151", borderRadius: 8, padding: "1px 6px" }}>{item.badge}</span>}
                </>}
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 6px", borderTop: "1px solid #1f2937" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, cursor: "pointer" }}>
            <Settings size={16} color="#6b7280" style={{ flexShrink: 0 }} />
            {!collapsed && <span style={{ fontSize: 12, color: "#9ca3af" }}>Settings</span>}
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ background: "#fff", padding: "14px 24px 16px", display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", flexShrink: 0, minHeight: 90, position: "relative", zIndex: 50 }}>
          {/* Center — Logo + Date */}
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <img src="/agent-hq-logo.png" alt="Agent HQ" style={{ height: 42, objectFit: "contain" }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginTop: 4, whiteSpace: "nowrap" }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
          {/* Right — Search, Bell, Avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f3f4f6", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
              <Search size={13} color="#9ca3af" />
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Search...</span>
            </div>
            <div style={{ position: "relative", cursor: "pointer" }}>
              <Bell size={18} color="#6b7280" />
              <div style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: "50%", background: "#ef4444", border: "2px solid #fff" }} />
            </div>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#c8a96e,#d4b878)", display: "flex", alignItems: "center", justifyContent: "center", color: "#111827", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>JW</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {/* Google reconnect banner — single place for all Google services */}
          <GoogleConnectionBanner />

          {/* Hour of Power — always visible */}
          <HourOfPowerBar />

          {/* Missed emails recovery — shows after Gmail reconnects from downtime */}
          <MissedEmailsBanner />

          {/* Morning briefing (only on briefing tab) */}
          {section === "briefing" && <MorningBriefing />}

          {/* Metrics row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {metricCards.map((c, i) => <MetricCard key={i} card={c} />)}
          </div>

          {/* Section content */}
          <SectionContent section={section} />
        </div>
      </div>
    </div>
    </EaContext.Provider>
    </FubContext.Provider>
  );
}
