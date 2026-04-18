import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import {
  Mail, Users, Calendar, Target, DollarSign, User, Dumbbell,
  UtensilsCrossed, Megaphone, BookOpen, Briefcase, Clock, Settings, Bell,
  Search, ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight, Phone,
  MapPin, CheckCircle2, FileText, Play, Pause, Square, PhoneCall, PhoneOff,
  UserCheck, CalendarPlus, Zap, MessageCircle, X, Sparkles, Timer, Star,
  Send, Archive, Reply, AlertTriangle, Coffee, Sun, Flame, Snowflake,
  UserPlus, RotateCcw, Eye, EyeOff, ChevronUp, MoreHorizontal, Inbox,
  Flag, Trash2, PenLine, Check, ExternalLink, RefreshCw,
  GripVertical, ClipboardList, Home, Plus, Save, Loader2, Trash,
} from "lucide-react";

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
// DATA: EMAIL TRIAGE (LIVE — pulled from Gmail)
// ─────────────────────────────────────────────
const emailInbox = [
  { id: 1, from: "Dan Landry", email: "dlandry0214@gmail.com", subject: "Re: 308 Christine", snippet: "Thank you for the update! However, I did want to revisit the strategy as what you are suggesting is slightly different from our recollection...", time: "8:40 PM (Apr 15)", category: "response_needed", priority: "high", suggestedAction: "Dan is questioning the listing strategy — revisit Plan A vs your recommendation. Reply today.", drafted: false, live: true },
  { id: 2, from: "BrokerBay", email: "info@mg.brokerbay.com", subject: "Showing Confirmed - 282 Robins Point Road", snippet: "Showing for 282 Robins Point Road has been CONFIRMED. Nick Cuong Chuong (LPT Realty) — Apr 22, 9:30 AM – 10:30 AM. Home Inspection.", time: "3:12 PM", category: "fyi", priority: "low", suggestedAction: "Showing confirmed. No action needed — notify sellers about upcoming home inspection.", drafted: false, live: true, resolved: true },
  { id: 3, from: "Vanessa Playtis", email: "vanessa@playtiscameronlaw.com", subject: "RE: 11 Joliet - Possible Holdback Required", snippet: "Update — we are still waiting on funds from the buyers to complete the sale. They have informed us that they are still waiting on their mortgage funds.", time: "1:46 PM", category: "response_needed", priority: "high", suggestedAction: "Closing delayed — buyer mortgage funds pending. Monitor and update Dani Thompson.", drafted: false, live: true },
  { id: 4, from: "Follow Up Boss", email: "leads@followupboss.com", subject: "Lead assigned - Vittorio Destefano", snippet: "New lead from Team: Brokerage Call-In. (647) 207-8660 — vdestefano@rogers.com", time: "3:40 PM (Apr 14)", category: "response_needed", priority: "medium", suggestedAction: "New inbound lead — call Vittorio at (647) 207-8660. Add to FUB pipeline.", drafted: false, live: true },
  { id: 5, from: "Lino D'Angicco", email: "ldangicco@rogers.com", subject: "Re: Listing(s) for your review", snippet: "well that's not great.", time: "5:40 PM (Apr 14)", category: "response_needed", priority: "medium", suggestedAction: "Lino seems disappointed — follow up to understand his concern and address it.", drafted: false, live: true },
  { id: 6, from: "Clare @ Faris Team", email: "Clare@faristeam.ca", subject: "Client Appreciation: Morning At the Movies Sign-up!", snippet: "Our Cineplex Client Appreciation event is fast approaching and we need YOUR HELP!", time: "12:11 PM", category: "fyi", priority: "low", suggestedAction: "Sign up for Cineplex client appreciation event if attending.", drafted: false, live: true },
  { id: 7, from: "Jeff @ Faris Team", email: "Jeff@faristeam.ca", subject: "📊 FARIS TEAM LISTINGS – WEEKLY UPDATE", snippet: "Week of April 6 to April 12 — listing activity improved. Sales, showings, and active listings all moving higher.", time: "12:56 PM (Apr 15)", category: "fyi", priority: "low", suggestedAction: "Review weekly listing stats. Buyer traffic picked up meaningfully.", drafted: false, live: true },
  { id: 8, from: "Jeff @ Faris Team", email: "Jeff@faristeam.ca", subject: "📊 SIMCOE COUNTY – WEEKLY MARKET UPDATE", snippet: "Week of April 6 to April 12 — Simcoe County market continued to build momentum through early spring.", time: "12:49 PM (Apr 15)", category: "fyi", priority: "low", suggestedAction: "Review Simcoe County market trends for client conversations.", drafted: false, live: true },
  { id: 9, from: "Jo (VA Hub)", email: "jo.thevahub@gmail.com", subject: "Jonathan Wallace EOD Report April 16, 2026", snippet: "I have organized the majority of your Outlook inbox emails up to April 12. Emails between April 12-19 remaining.", time: "1:22 PM", category: "fyi", priority: "low", suggestedAction: "VA progress update — Outlook inbox organized to April 12. No action needed.", drafted: false, live: true },
  { id: 10, from: "REALM", email: "notifications@em.realmmlp.ca", subject: "[REALM] Your clients' saved searches have found listings", snippet: "Edward Kariuki's search — Homes in Midland and Area $350-$500k found two listings on Apr 15.", time: "2:07 AM", category: "followup_others", priority: "medium", suggestedAction: "Forward Midland listings to Edward Kariuki. 819 Birchwood Dr matched his search.", drafted: false, live: true },
  { id: 11, from: "SISU", email: "noreply@sisu.co", subject: "Amendment to Deal Received — 62 O'Shaughnessy", snippet: "An amendment has been received for this deal. Sales Partner: Jonathan Wallace. Shane Steenhoek.", time: "5:13 PM (Apr 15)", category: "fyi", priority: "low", suggestedAction: "Amendment logged in SISU for 62 O'Shaughnessy. Kim already sent accepted amendment.", drafted: false, live: true },
  { id: 12, from: "Make.com", email: "noreply@us2.make.com", subject: "🛑 Encountered errors in Agent Gmail Gateway scenario", snippet: "Your scenario Agent Gmail Gateway has encountered multiple errors.", time: "3:12 PM (Apr 14)", category: "auto_file", priority: "none", suggestedAction: "Make.com automation errors — check Agent Gmail Gateway scenario when you have time.", drafted: false, live: true },
];

// ─────────────────────────────────────────────
// DATA: CALENDAR (Google Calendar — connection needs refresh)
// ─────────────────────────────────────────────
// NOTE: Google Calendar MCP integration needs reconnection.
// Showing only BrokerBay-confirmed events as LIVE data for now.
const todayCalendar = [
  { time: "2:00 PM", end: "3:00 PM", title: "Showing — 481 Islandview Lane, Midland", type: "showing", color: "#10b981", icon: CheckCircle2, source: "brokerbay", live: true },
];
const gcalConnectionStatus = { connected: false, reason: "Google Calendar integration needs refresh — reconnect to pull full calendar." };

// ─────────────────────────────────────────────
// DATA: BROKERBAY SHOWINGS (LIVE — parsed from Gmail)
// ─────────────────────────────────────────────
const brokerBayShowings = [
  // YESTERDAY — completed (Jonathan attended as buyer agent)
  { id: "bb-1", time: "12:30 PM", end: "1:30 PM", date: "Thu, Apr 16", property: "45 Brule Street, Penetanguishene", mls: "—", status: "completed",
    requestedBy: "Jonathan Wallace (Buyer Agent)", buyerAgent: "Jonathan Wallace",
    buyerName: "—", sellerName: "Peggy Hill / Christine Hanna (Re/Max Hallmark Peggy Hill Group)",
    notes: "Modified from 3:30 PM → 12:30 PM. Feedback requested by listing agent.", lockboxCode: "4610",
    source: "brokerbay", live: true, role: "buyer_agent" },
  // TODAY — your listing 612 Bay St (CANCELLED via BrokerBay email)
  { id: "bb-2", time: "11:15 AM", end: "12:15 PM", date: "Today", property: "612 Bay Street, Midland", mls: "—", status: "cancelled",
    requestedBy: "Caitlin Danielle Renton (Renton Realty)", buyerAgent: "Caitlin Danielle Renton",
    buyerName: "—", sellerName: "Your Listing",
    notes: "CANCELLED — Caitlin Renton cancelled this showing. Originally confirmed for 11:15 AM.", lockboxCode: "—",
    source: "brokerbay", live: true, role: "listing_agent" },
  // TODAY — your listing 481 Islandview Lane
  { id: "bb-3", time: "2:00 PM", end: "3:00 PM", date: "Today", property: "481 Islandview Lane, Midland", mls: "—", status: "confirmed",
    requestedBy: "Jordan Iles (Real Broker Ontario Ltd.)", buyerAgent: "Jordan Iles",
    buyerName: "—", sellerName: "Your Listing",
    notes: "Jordan Iles — jiles@teamjordan.ca — Real Broker Ontario: 888-311-1172.", lockboxCode: "—",
    source: "brokerbay", live: true, role: "listing_agent" },
  // SUNDAY — your listing 612 Bay St
  { id: "bb-4", time: "12:30 PM", end: "1:30 PM", date: "Sun, Apr 19", property: "612 Bay Street, Midland", mls: "—", status: "confirmed",
    requestedBy: "Rhys Williams (Keller Williams Experience Realty)", buyerAgent: "Rhys Williams",
    buyerName: "—", sellerName: "Your Listing",
    notes: "Rhys Williams — rhys@torrogroup.ca — Keller Williams: 705-720-2200.", lockboxCode: "—",
    source: "brokerbay", live: true, role: "listing_agent" },
  // NEXT WEEK — your listing 282 Robins Point Road (CONFIRMED)
  { id: "bb-5", time: "9:30 AM", end: "10:30 AM", date: "Wed, Apr 22", property: "282 Robins Point Road", mls: "—", status: "confirmed",
    requestedBy: "Nick Cuong Chuong (LPT Realty)", buyerAgent: "Nick Cuong Chuong",
    buyerName: "—", sellerName: "Your Listing",
    notes: "Home Inspection showing. Confirmed via BrokerBay.", lockboxCode: "—",
    source: "brokerbay", live: true, role: "listing_agent" },
];

const brokerBaySyncStatus = {
  connected: true,
  lastSync: "Just now — pulled from Gmail",
  calendarFeedUrl: "webcal://edge.brokerbay.com/ical/agent/jw-9482.ics",
  googleCalendarLinked: true,
  totalShowingsThisWeek: 4,
  confirmedCount: 3,
  completedCount: 1,
  cancelledCount: 1,
  pendingCount: 0,
};

// ─────────────────────────────────────────────
// DATA: METRICS + PIPELINE
// ─────────────────────────────────────────────
const metricCards = [
  { title: "New Leads", value: "47", change: "+12%", trend: "up", period: "This month", color: "#2563eb", target: 60, current: 47 },
  { title: "Active Deals", value: "8", change: "+2", trend: "up", period: "In pipeline", color: "#f59e0b", target: 12, current: 8 },
  { title: "Deals Closed", value: "3", change: "+1", trend: "up", period: "This month", color: "#10b981", target: 5, current: 3 },
  { title: "Closed Volume", value: "$1.2M", change: "+18%", trend: "up", period: "This quarter", color: "#8b5cf6", target: 100, current: 72 },
];

const sidebarItems = [
  { id: "briefing", label: "Morning Brief", icon: Sun, badge: null },
  { id: "priorities", label: "Top Priorities", icon: Target, badge: 3 },
  { id: "calls", label: "Call List", icon: Phone, badge: 10 },
  { id: "emails", label: "Emails", icon: Mail, badge: 12 },
  { id: "crm", label: "Follow Up Boss", icon: Users, badge: null },
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
  { id: "listing-form", label: "Listing Form", icon: ClipboardList, badge: null },
  { id: "sellers", label: "Sellers", icon: Briefcase, badge: 3 },
  { id: "loo", label: "LOO", icon: FileText, badge: null },
];

// ─────────────────────────────────────────────
// DATA: TOP PRIORITIES OF THE DAY
// ─────────────────────────────────────────────
const defaultBig3 = [
  { id: 1, text: "Reply to Dan Landry re: 308 Christine listing strategy", done: false, category: "deal", categoryColor: "#ef4444", live: true },
  { id: 2, text: "Notify sellers about confirmed home inspection — 282 Robins Point Rd (Apr 22, 9:30 AM)", done: false, category: "showing", categoryColor: "#2563eb", live: true },
  { id: 3, text: "Follow up on 11 Joliet closing — buyer mortgage funds pending", done: false, category: "deal", categoryColor: "#ef4444", live: true },
];

const backlogTasks = [
  { id: 4, text: "Call new FUB lead Vittorio Destefano — (647) 207-8660", done: false, category: "lead", categoryColor: "#f59e0b", live: true },
  { id: 5, text: "Respond to Lino D'Angicco re: listings review", done: false, category: "lead", categoryColor: "#f59e0b", live: true },
  { id: 6, text: "Forward REALM listings to Edward Kariuki — Midland $350-$500k", done: false, category: "lead", categoryColor: "#f59e0b", live: true },
  { id: 7, text: "Submit outstanding feedback for 45 Brule St showing (yesterday)", done: false, category: "showing", categoryColor: "#2563eb", live: true },
  { id: 8, text: "Sign up for Faris Team Cineplex Client Appreciation event", done: false, category: "marketing", categoryColor: "#8b5cf6", live: true },
  { id: 9, text: "Review Make.com Agent Gmail Gateway errors", done: false, category: "tech", categoryColor: "#6b7280", live: true },
];

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
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const displayEvents = status.connected && events.length > 0 ? events : null;
  const fallbackEvents = todayCalendar;

  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Calendar size={14} color="#d97706" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
          {displayEvents ? events.length : fallbackEvents.length} event{(displayEvents ? events.length : fallbackEvents.length) !== 1 ? "s" : ""} today
        </span>
        {status.connected
          ? <span style={{ fontSize: 9, fontWeight: 600, color: "#059669", background: "#ecfdf5", padding: "1px 5px", borderRadius: 3 }}>GCal live</span>
          : <span style={{ fontSize: 9, fontWeight: 600, color: "#d97706", background: "#fef3c7", padding: "1px 5px", borderRadius: 3 }}>GCal offline</span>
        }
      </div>
      {displayEvents ? displayEvents.slice(0, 5).map((ev, i) => (
        <div key={ev.id || i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 3, height: 20, borderRadius: 2, background: "#2563eb", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{ev.title}</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>{ev.allDay ? "All day" : formatTime(ev.start)}</div>
          </div>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 4px", borderRadius: 3 }}>LIVE</span>
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
      {!status.connected && (
        <button onClick={() => { window.location.href = '/api/auth/google'; }} style={{
          marginTop: 6, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", border: "none",
          padding: "6px 12px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center",
        }}>
          <RefreshCw size={10} /> Reconnect Google Calendar
        </button>
      )}
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

function MorningBriefing() {
  const urgentEmails = emailInbox.filter(e => e.category === "response_needed");
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
        {/* Listing Showings snapshot — LIVE from Gmail */}
        <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <MapPin size={14} color="#e11d48" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>Showings</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
          </div>
          {brokerBayShowings.filter(s => s.date === "Today" && s.status !== "cancelled").slice(0, 3).map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: s.status === "completed" ? "#2563eb" : s.status === "confirmed" ? "#059669" : "#d97706", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.property.split(",")[0]}</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>{s.date} &middot; {s.time} &middot; {s.status}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Calendar snapshot */}
        <MorningCalendarSnapshot />

        {/* Emails needing response */}
        <div style={{ background: "#fff", borderRadius: 10, padding: 14, border: "1px solid #fde68a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Mail size={14} color="#dc2626" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>{urgentEmails.length} emails need you</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
          </div>
          {urgentEmails.slice(0, 3).map((em, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: em.priority === "high" ? "#fef2f2" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: em.priority === "high" ? "#ef4444" : "#6b7280" }}>{em.from.charAt(0)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{em.from}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{em.subject}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Call list preview — LIVE from Follow Up Boss */}
        <CallListPreview />
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
                <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 3 }}>LIVE</span>
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{c.name}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: c.tagColor, background: c.tagBg, padding: "1px 6px", borderRadius: 4 }}>{c.fubStage}</span>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{c.context}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginRight: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{c.phone}</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>Last: {c.lastContact}</div>
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
// EMAIL EA SECTION
// ─────────────────────────────────────────────
function EmailEASection() {
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [actions, setActions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agenthq-email-actions') || '{}'); } catch { return {}; }
  });
  const persistActions = (updater) => {
    setActions(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('agenthq-email-actions', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const categories = [
    { key: "response_needed", label: "Needs Your Response", color: "#ef4444", bg: "#fef2f2", icon: Reply, count: emailInbox.filter(e => e.category === "response_needed").length },
    { key: "followup_others", label: "Waiting on Others", color: "#f59e0b", bg: "#fffbeb", icon: Clock, count: emailInbox.filter(e => e.category === "followup_others").length },
    { key: "fyi", label: "FYI Only", color: "#6b7280", bg: "#f3f4f6", icon: Eye, count: emailInbox.filter(e => e.category === "fyi").length },
    { key: "auto_file", label: "Auto-Filed", color: "#10b981", bg: "#ecfdf5", icon: Archive, count: emailInbox.filter(e => e.category === "auto_file").length },
  ];

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SectionHeader title="Email Assistant" count={emailInbox.length} action="Open Gmail →" />
        <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 3, marginTop: -4 }}>LIVE</span>
      </div>

      {/* Category tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {categories.map(cat => {
          const CIcon = cat.icon;
          return (
            <div key={cat.key} style={{ display: "flex", alignItems: "center", gap: 5, background: cat.bg, borderRadius: 8, padding: "6px 12px", border: `1px solid ${cat.color}20` }}>
              <CIcon size={12} color={cat.color} />
              <span style={{ fontSize: 11, fontWeight: 700, color: cat.color }}>{cat.count}</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>{cat.label}</span>
            </div>
          );
        })}
      </div>

      {/* Email list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {emailInbox.map(em => {
          const isSelected = selectedEmail === em.id;
          const catColor = em.category === "response_needed" ? "#ef4444" : em.category === "followup_others" ? "#f59e0b" : em.category === "auto_file" ? "#10b981" : "#6b7280";
          const acted = actions[em.id] || em.resolved;

          return (
            <div key={em.id}>
              <div onClick={() => setSelectedEmail(isSelected ? null : em.id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                background: acted ? "#f0fdf4" : isSelected ? "#eff6ff" : em.category === "response_needed" ? "#fef2f2" : "#fafafa",
                border: isSelected ? "1px solid #bfdbfe" : acted ? "1px solid #bbf7d0" : "1px solid transparent",
                opacity: acted ? 0.6 : 1,
              }}>
                <div style={{ width: 4, height: 30, borderRadius: 2, background: acted ? "#10b981" : catColor, flexShrink: 0 }} />
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: (acted ? "#10b981" : catColor) + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {acted ? <CheckCircle2 size={14} color="#10b981" /> : <span style={{ fontSize: 12, fontWeight: 800, color: catColor }}>{em.from.charAt(0)}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: acted ? "#6b7280" : "#111827" }}>{em.from}</span>
                    {em.resolved && <span style={{ fontSize: 9, fontWeight: 700, color: "#10b981", background: "#ecfdf5", padding: "1px 5px", borderRadius: 3 }}>CONFIRMED</span>}
                    {!em.resolved && em.priority === "high" && <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "#fef2f2", padding: "1px 5px", borderRadius: 3 }}>URGENT</span>}
                  </div>
                  <div style={{ fontSize: 12, color: acted ? "#9ca3af" : "#374151", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{em.subject}</div>
                </div>
                <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{em.time}</span>
                {isSelected ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
              </div>

              {/* Expanded EA suggestion */}
              {isSelected && !acted && (
                <div style={{ marginLeft: 16, marginTop: 4, background: "#f0f9ff", borderRadius: 10, padding: 14, border: "1px solid #bae6fd" }}>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{em.snippet}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Sparkles size={12} color="#2563eb" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>EA Suggestion:</span>
                    <span style={{ fontSize: 12, color: "#374151" }}>{em.suggestedAction}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => persistActions(a => ({ ...a, [em.id]: "replied" }))} style={{ display: "flex", alignItems: "center", gap: 4, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Reply size={11} /> Draft Reply</button>
                    <button onClick={() => persistActions(a => ({ ...a, [em.id]: "flagged" }))} style={{ display: "flex", alignItems: "center", gap: 4, background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Flag size={11} /> Flag for Later</button>
                    <button onClick={() => persistActions(a => ({ ...a, [em.id]: "filed" }))} style={{ display: "flex", alignItems: "center", gap: 4, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><Archive size={11} /> File</button>
                  </div>
                </div>
              )}
              {isSelected && acted && (
                <div style={{ marginLeft: 16, marginTop: 4, background: "#ecfdf5", borderRadius: 8, padding: "8px 12px", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={13} color="#10b981" />
                  <span style={{ fontSize: 12, color: "#065f46", fontWeight: 500 }}>
                    {acted === "replied" ? "Draft saved. Review before sending." : acted === "flagged" ? "Flagged for follow-up." : "Filed away."}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
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

      {/* Connection Status Banner */}
      {!gcalStatus.connected && !loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 12 }}>
          <AlertTriangle size={16} color="#d97706" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>Google Calendar disconnected</div>
            <div style={{ fontSize: 11, color: "#b45309" }}>
              {gcalStatus.configured
                ? "Session expired — one click to reconnect."
                : "Set up OAuth credentials in Railway, then connect."}
            </div>
          </div>
          {gcalStatus.configured && (
            <button onClick={reconnect} style={{
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", border: "none",
              padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
            }}>
              <RefreshCw size={12} /> Reconnect
            </button>
          )}
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
                <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#10b981", padding: "1px 5px", borderRadius: 3 }}>LIVE</span>
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

  const statusStyles = {
    confirmed: { color: "#059669", bg: "#ecfdf5", label: "Confirmed" },
    completed: { color: "#2563eb", bg: "#eff6ff", label: "Completed" },
    pending: { color: "#d97706", bg: "#fffbeb", label: "Pending" },
    requested: { color: "#7c3aed", bg: "#f5f3ff", label: "Requested" },
    cancelled: { color: "#dc2626", bg: "#fef2f2", label: "Cancelled" },
  };

  const listingShowings = brokerBayShowings.filter(s => s.role === "listing_agent");
  const buyerShowings = brokerBayShowings.filter(s => s.role === "buyer_agent");

  const showTabs = [
    { id: "upcoming", label: "Upcoming" },
    { id: "all", label: `All (${brokerBaySyncStatus.totalShowingsThisWeek})` },
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: brokerBaySyncStatus.connected ? "#10b981" : "#ef4444" }} />
          <span style={{ fontSize: 10, color: "#6b7280" }}>BrokerBay {brokerBaySyncStatus.lastSync}</span>
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Listings", val: listingShowings.filter(s => s.status !== "cancelled").length, color: "#8b5cf6", bg: "#f5f3ff" },
          { label: "Buyer", val: buyerShowings.filter(s => s.status !== "cancelled").length, color: "#059669", bg: "#ecfdf5" },
          { label: "Confirmed", val: brokerBaySyncStatus.confirmedCount, color: "#2563eb", bg: "#eff6ff" },
          { label: "Cancelled", val: brokerBaySyncStatus.cancelledCount || 0, color: "#dc2626", bg: "#fef2f2" },
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
          {brokerBayShowings.map(s => {
            const st = statusStyles[s.status] || { color: "#6b7280", bg: "#f3f4f6", label: s.status };
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "#fff", border: "1px solid #f0f0f0" }}>
                <div style={{ width: 4, height: 36, borderRadius: 2, background: "#e11d48", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{s.property}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.date} &middot; {s.time} — {s.end} &middot; {s.buyerAgent}</div>
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
              <div style={{ fontWeight: 600, color: "#111827" }}>{brokerBaySyncStatus.lastSync}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}>This Week</div>
              <div style={{ fontWeight: 600, color: "#111827" }}>{brokerBaySyncStatus.totalShowingsThisWeek} showings</div>
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
  const [priorities, setPriorities] = useState(defaultBig3);
  const [backlog, setBacklog] = useState(backlogTasks);
  const [newTask, setNewTask] = useState("");
  const [showBacklog, setShowBacklog] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const [completing, setCompleting] = useState(null); // id of task being completed (for animation)
  const [doneCount, setDoneCount] = useState(0); // total tasks completed this session
  const [doneIds, setDoneIds] = useState([]); // track which task IDs have been completed
  const [loaded, setLoaded] = useState(false);

  // Load saved state — try server first, fall back to localStorage backup
  useEffect(() => {
    (async () => {
      let stateLoaded = false;

      // 1. Try server
      try {
        const res = await fetch('/api/tasks');
        const { state } = await res.json();
        if (state && state.priorities && state.savedAt) {
          setPriorities(state.priorities);
          setBacklog(state.backlog || []);
          setDoneCount(state.doneCount || 0);
          setDoneIds(state.doneIds || []);
          stateLoaded = true;
          // Update localStorage backup with server data
          try { localStorage.setItem('agenthq-tasks', JSON.stringify(state)); } catch {}
        }
      } catch { /* server unavailable */ }

      // 2. If server had nothing, try localStorage backup
      if (!stateLoaded) {
        try {
          const backup = localStorage.getItem('agenthq-tasks');
          if (backup) {
            const state = JSON.parse(backup);
            if (state && state.priorities && state.savedAt) {
              setPriorities(state.priorities);
              setBacklog(state.backlog || []);
              setDoneCount(state.doneCount || 0);
              setDoneIds(state.doneIds || []);
              stateLoaded = true;
              console.log('[Tasks] Restored from localStorage backup (server had no data — likely redeployed)');
              // Push the backup back to server so it's in sync
              fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: backup,
              }).catch(() => {});
            }
          }
        } catch { /* no backup available */ }
      }

      if (!stateLoaded) {
        console.log('[Tasks] No saved state found — using defaults');
      }

      setLoaded(true);
    })();
  }, []);

  // Save state to server + localStorage whenever priorities/backlog/doneCount change (debounced)
  useEffect(() => {
    if (!loaded) return; // don't save before initial load
    const timer = setTimeout(() => {
      const payload = { priorities, backlog, doneCount, doneIds, savedAt: new Date().toISOString() };

      // Save to server
      fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

      // Save to localStorage as backup (survives server redeploys)
      try { localStorage.setItem('agenthq-tasks', JSON.stringify(payload)); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [priorities, backlog, doneCount, doneIds, loaded]);

  const markDone = (id) => {
    // Show green checkmark briefly
    setCompleting(id);
    setPriorities(prev => prev.map(t => t.id === id ? { ...t, done: true } : t));
    // After brief delay, remove completed task and pull next from backlog
    setTimeout(() => {
      setDoneCount(c => c + 1);
      setDoneIds(prev => [...prev, id]);
      setPriorities(prev => {
        const remaining = prev.filter(t => t.id !== id);
        return remaining;
      });
      setBacklog(prev => {
        const nextTask = prev.find(t => !t.done);
        if (nextTask) {
          setPriorities(curr => {
            if (curr.length < 3) return [...curr, nextTask];
            return curr;
          });
          return prev.filter(t => t.id !== nextTask.id);
        }
        return prev;
      });
      setCompleting(null);
    }, 600);
  };

  const toggleBacklog = (id) => setBacklog(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));

  const promoteTask = (task) => {
    if (priorities.length >= 3) return;
    setBacklog(prev => prev.filter(t => t.id !== task.id));
    setPriorities(prev => [...prev, task]);
  };

  const demoteTask = (task) => {
    setPriorities(prev => prev.filter(t => t.id !== task.id));
    setBacklog(prev => [{ ...task, done: false }, ...prev]);
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    const task = { id: Date.now(), text: newTask, done: false, category: "task", categoryColor: "#6b7280" };
    setBacklog(prev => [task, ...prev]);
    setNewTask("");
  };

  // Drag handlers for reordering
  const handleDragStart = (idx) => { setDragFrom(idx); };
  const handleDragEnter = (idx) => { setDragOver(idx); };
  const handleDragEnd = () => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      setPriorities(prev => {
        const items = [...prev];
        const [moved] = items.splice(dragFrom, 1);
        items.splice(dragOver, 0, moved);
        return items;
      });
    }
    setDragFrom(null);
    setDragOver(null);
  };

  // Click to move up/down
  const moveUp = (idx) => {
    if (idx === 0) return;
    setPriorities(prev => {
      const items = [...prev];
      [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
      return items;
    });
  };
  const moveDown = (idx) => {
    if (idx >= priorities.length - 1) return;
    setPriorities(prev => {
      const items = [...prev];
      [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
      return items;
    });
  };

  const totalTasks = priorities.length + backlog.length + doneCount;
  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const allDone = priorities.length === 0 && backlog.filter(t => !t.done).length === 0;

  return (
    <Card>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: allDone ? "#ecfdf5" : "linear-gradient(135deg,#eff6ff,#f0f9ff)", display: "flex", alignItems: "center", justifyContent: "center", border: allDone ? "1px solid #bbf7d0" : "1px solid #bfdbfe" }}>
            <Target size={16} color={allDone ? "#10b981" : "#2563eb"} />
          </div>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
              Top Priorities {allDone && <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>— All done!</span>}
            </h3>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Drag to reorder. The things that move the needle today.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 60, height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${progressPct}%`, height: "100%", background: allDone ? "#10b981" : "#2563eb", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: allDone ? "#10b981" : "#2563eb" }}>{doneCount}/{totalTasks}</span>
        </div>
      </div>

      {/* Priority list — draggable */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {priorities.map((task, idx) => (
          <div
            key={task.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10,
              background: dragOver === idx && dragFrom !== idx ? "#eff6ff" : task.done ? "#f0fdf4" : "#fff",
              border: dragOver === idx && dragFrom !== idx ? "2px solid #93c5fd" : task.done ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
              boxShadow: dragFrom === idx ? "0 4px 12px rgba(0,0,0,0.1)" : task.done ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
              opacity: completing === task.id ? 0.4 : dragFrom === idx ? 0.5 : 1,
              transform: completing === task.id ? "scale(0.97)" : "none",
              cursor: "grab", transition: "all 0.15s ease",
              userSelect: "none",
            }}
          >
            {/* Drag handle */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, cursor: "grab", padding: "4px 2px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 2 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#c8a96e" }} />
              </div>
            </div>

            {/* Priority number */}
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: task.done ? "#10b981" : idx === 0 ? "#ef4444" : idx === 1 ? "#f59e0b" : "#2563eb",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              {task.done
                ? <Check size={13} color="#fff" />
                : <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{idx + 1}</span>
              }
            </div>

            {/* Task text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: task.done ? "#6b7280" : "#111827",
                textDecoration: task.done ? "line-through" : "none",
              }}>
                {task.text}
              </div>
            </div>

            {/* Category tag */}
            <span style={{ fontSize: 9, fontWeight: 700, color: task.categoryColor, background: task.categoryColor + "12", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>{task.category}</span>

            {/* Reorder arrows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0 }}>
              <button onClick={() => moveUp(idx)} disabled={idx === 0} style={{
                background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer",
                color: idx === 0 ? "#e5e7eb" : "#9ca3af", padding: "1px 3px", lineHeight: 0,
              }}>
                <ChevronUp size={13} />
              </button>
              <button onClick={() => moveDown(idx)} disabled={idx >= priorities.length - 1} style={{
                background: "none", border: "none", cursor: idx >= priorities.length - 1 ? "default" : "pointer",
                color: idx >= priorities.length - 1 ? "#e5e7eb" : "#9ca3af", padding: "1px 3px", lineHeight: 0,
              }}>
                <ChevronDown size={13} />
              </button>
            </div>

            {/* Done / Demote */}
            <button onClick={() => !task.done && markDone(task.id)} disabled={task.done || completing === task.id} style={{
              background: task.done || completing === task.id ? "#d1fae5" : "#f3f4f6", border: "none", borderRadius: 6,
              padding: "5px 10px", fontSize: 11, cursor: task.done ? "default" : "pointer",
              color: task.done || completing === task.id ? "#065f46" : "#6b7280", fontWeight: 600,
              transition: "all 0.3s ease",
            }}>
              {task.done ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Check size={11} /> Done</span> : "Done"}
            </button>
            <button onClick={() => demoteTask(task)} style={{
              background: "none", border: "none", color: "#d1d5db", cursor: "pointer", padding: 4,
            }} title="Move to backlog">
              <X size={13} />
            </button>
          </div>
        ))}

        {/* Empty slots */}
        {priorities.length < 3 && Array.from({ length: 3 - priorities.length }).map((_, i) => (
          <div key={`empty-${i}`} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "14px", borderRadius: 10, border: "2px dashed #e5e7eb", color: "#d1d5db",
          }}>
            <Target size={14} />
            <span style={{ fontSize: 12 }}>Promote a task from the backlog</span>
          </div>
        ))}
      </div>

      {/* Backlog */}
      <div>
        <button onClick={() => setShowBacklog(!showBacklog)} style={{
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
          color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 0",
        }}>
          {showBacklog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Backlog ({backlog.length} tasks)
        </button>

        {showBacklog && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()}
                placeholder="Add a task..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, outline: "none" }} />
              <button onClick={addTask} style={{
                background: "#2563eb", color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <PenLine size={11} /> Add
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {backlog.map(task => (
                <div key={task.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8,
                  background: task.done ? "#f9fafb" : "#fafafa", opacity: task.done ? 0.5 : 1,
                }}>
                  <button onClick={() => toggleBacklog(task.id)} style={{
                    width: 18, height: 18, borderRadius: "50%", border: task.done ? "none" : "2px solid #d1d5db",
                    background: task.done ? "#10b981" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", flexShrink: 0,
                  }}>
                    {task.done && <Check size={10} color="#fff" />}
                  </button>
                  <span style={{
                    fontSize: 12, color: task.done ? "#9ca3af" : "#374151", flex: 1,
                    textDecoration: task.done ? "line-through" : "none",
                  }}>{task.text}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: task.categoryColor, background: task.categoryColor + "10", padding: "1px 5px", borderRadius: 3 }}>{task.category}</span>
                  {priorities.length < 3 && !task.done && (
                    <button onClick={() => promoteTask(task)} style={{
                      background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe",
                      borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 3,
                    }}>
                      <ChevronUp size={10} /> Priority
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
// LIVE listings — parsed from BrokerBay emails (you are listing agent)
const activeListings = [
  {
    id: "lst-1", address: "612 Bay Street, Midland, ON", mls: "L4R 1L6", price: "—",
    daysOnMarket: "—", seller: { name: "Jonathan Wallace (Listing Agent)", phone: "—" },
    sellerClient: { name: "— (update in FUB)", phone: "—", fubId: "—" },
    photo: null, status: "active", live: true,
  },
  {
    id: "lst-2", address: "481 Islandview Lane, Midland, ON", mls: "L4R 5H4", price: "—",
    daysOnMarket: "—", seller: { name: "Jonathan Wallace (Listing Agent)", phone: "—" },
    sellerClient: { name: "— (update in FUB)", phone: "—", fubId: "—" },
    photo: null, status: "active", live: true,
  },
  {
    id: "lst-3", address: "282 Robins Point Road", mls: "L0K 2A0", price: "—",
    daysOnMarket: "—", seller: { name: "Jonathan Wallace (Listing Agent)", phone: "—" },
    sellerClient: { name: "— (update in FUB)", phone: "—", fubId: "—" },
    photo: null, status: "active", live: true,
  },
];

// LIVE — parsed from actual BrokerBay emails in Gmail (Apr 14–16)
const showingIntelligence = [
  // 612 Bay Street — YOUR LISTING
  { id: "si-1", listingId: "lst-1", address: "612 Bay Street, Midland", date: "Apr 14", time: "—", end: "—",
    buyerAgent: "Rhys Williams (Keller Williams Experience Realty)", buyerAgentPhone: "705-720-2200", buyerAgentEmail: "rhys@torrogroup.ca",
    status: "confirmed", feedbackStatus: "n/a", live: true,
    feedback: null,
    sellerNotified: false, sellerNotifiedAt: null,
    emailSource: "info@mg.brokerbay.com", emailSubject: "Showing Request - 612 Bay Street", parsedAt: "Apr 14, 4:07 PM",
    followUpSentAt: null, followUpType: null,
    notes: "Initial request — required listing agent confirmation.",
  },
  { id: "si-2", listingId: "lst-1", address: "612 Bay Street, Midland", date: "Fri, Apr 17", time: "11:15 AM", end: "12:15 PM",
    buyerAgent: "Caitlin Danielle Renton (Renton Realty)", buyerAgentPhone: "647-273-9850", buyerAgentEmail: "caitlinrenton@outlook.com",
    status: "cancelled", feedbackStatus: "n/a", live: true,
    feedback: null,
    sellerNotified: false, sellerNotifiedAt: null,
    emailSource: "info@mg.brokerbay.com", emailSubject: "Showing Cancelled - 612 Bay Street", parsedAt: "Apr 17, 10:30 AM",
    followUpSentAt: null, followUpType: null,
    notes: "CANCELLED by Caitlin Renton. Matched by address (612 Bay Street) + time (11:15 AM) + agent (Caitlin Danielle Renton).",
  },
  { id: "si-3", listingId: "lst-1", address: "612 Bay Street, Midland", date: "Sun, Apr 19", time: "12:30 PM", end: "1:30 PM",
    buyerAgent: "Rhys Williams (Keller Williams Experience Realty)", buyerAgentPhone: "705-720-2200", buyerAgentEmail: "rhys@torrogroup.ca",
    status: "confirmed", feedbackStatus: "n/a", live: true,
    feedback: null,
    sellerNotified: false, sellerNotifiedAt: null,
    emailSource: "info@mg.brokerbay.com", emailSubject: "Showing Confirmed - 612 Bay Street", parsedAt: "Apr 15, 9:49 AM",
    followUpSentAt: null, followUpType: null,
    notes: "Second showing request from Rhys — strong buyer interest signal.",
  },
  // 481 Islandview Lane — YOUR LISTING
  { id: "si-4", listingId: "lst-2", address: "481 Islandview Lane, Midland", date: "Fri, Apr 17", time: "2:00 PM", end: "3:00 PM",
    buyerAgent: "Jordan Iles (Real Broker Ontario Ltd.)", buyerAgentPhone: "888-311-1172", buyerAgentEmail: "jiles@teamjordan.ca",
    status: "confirmed", feedbackStatus: "n/a", live: true,
    feedback: null,
    sellerNotified: false, sellerNotifiedAt: null,
    emailSource: "info@mg.brokerbay.com", emailSubject: "Showing Confirmed - 481 Islandview Lane", parsedAt: "Apr 16, 10:55 AM",
    followUpSentAt: null, followUpType: null,
    notes: "Request came in at 9:10 AM, confirmed at 10:55 AM same day.",
  },
  // 282 Robins Point Road — YOUR LISTING (CONFIRMED)
  { id: "si-5", listingId: "lst-3", address: "282 Robins Point Road", date: "Wed, Apr 22", time: "9:30 AM", end: "10:30 AM",
    buyerAgent: "Nick Cuong Chuong (LPT Realty)", buyerAgentPhone: "—", buyerAgentEmail: "—",
    status: "confirmed", feedbackStatus: "n/a", live: true,
    feedback: null,
    sellerNotified: false, sellerNotifiedAt: null,
    emailSource: "info@mg.brokerbay.com", emailSubject: "Showing Confirmed - 282 Robins Point Road", parsedAt: "Apr 17, 3:45 PM",
    followUpSentAt: null, followUpType: null,
    notes: "Home Inspection showing — CONFIRMED. Notify sellers about upcoming inspection.",
  },
];

// ─────────────────────────────────────────────
// DATA: OUTSTANDING FEEDBACK (you need to give)
// LIVE — parsed from BrokerBay feedback request emails
// ─────────────────────────────────────────────
const outstandingFeedback = [
  {
    id: "fb-1", address: "45 Brule Street, Penetanguishene", date: "Yesterday, Apr 16", time: "12:30 PM — 1:30 PM",
    listingAgent: "Peggy Hill / Christine Hanna", brokerage: "Re/Max Hallmark Peggy Hill Group Realty",
    listingAgentEmail: "info@peggyhill.com", listingAgentPhone: "(705) 739-4455",
    status: "outstanding", live: true, role: "buyer_agent",
    emailReceivedAt: "Yesterday, 2:31 PM",
    feedbackUrl: "https://edge.brokerbay.com/#/my_business/showing/69e0071d5decc06c3285a17e?redirectTo=calendar",
    notes: "You showed this property yesterday. Feedback survey link was sent to jonathan@faristeam.ca.",
  },
];

// DRAFT — AI-generated follow-up messages (clearly marked)
const followUpQueue = [
  // fq-1 and fq-2 REMOVED — 612 Bay St showing (Caitlin Renton) was cancelled via BrokerBay
  {
    id: "fq-3", showingId: "si-4", address: "481 Islandview Lane, Midland", type: "seller_sms",
    recipient: "Seller (update name in FUB)", phone: "—",
    scheduledFor: "Fri, Apr 17 — 5:00 PM", status: "draft", draft: true,
    message: "Hi — the showing at 481 Islandview Lane finished this afternoon. Jordan Iles from Real Broker Ontario brought a buyer through. We're chasing feedback now and will update you as soon as we have it. — Jonathan",
  },
  {
    id: "fq-4", showingId: "si-4", address: "481 Islandview Lane, Midland", type: "agent_email",
    recipient: "Jordan Iles (Real Broker Ontario Ltd.)", phone: "888-311-1172",
    scheduledFor: "Fri, Apr 17 — 5:00 PM", status: "draft", draft: true,
    message: "Hi Jordan — thanks for showing 481 Islandview Lane today. Would love to hear what your buyers thought. Any feedback on the property, price, or features? Thanks! — Jonathan Wallace",
  },
  {
    id: "fq-5", showingId: "si-3", address: "612 Bay Street, Midland", type: "seller_sms",
    recipient: "Seller (update name in FUB)", phone: "—",
    scheduledFor: "Sun, Apr 19 — 3:30 PM", status: "draft", draft: true,
    message: "Hi — Rhys Williams from Keller Williams just finished showing 612 Bay Street. This is his second visit, which is a strong sign. Chasing feedback now. — Jonathan",
  },
];

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
// ─────────────────────────────────────────────

const HEATING_OPTIONS = ['Forced Air Gas', 'Forced Air Propane', 'Electric Baseboard', 'Radiant In-Floor', 'Mini-Split', 'Wood Stove', 'Pellet Stove', 'Oil Furnace', 'Geothermal', 'Boiler / Radiator'];
const AC_OPTIONS = ['Central Air', 'Ductless Mini-Split', 'Window Units', 'None'];
const APPLIANCE_OPTIONS = ['Fridge', 'Stove', 'Dishwasher', 'Microwave', 'Washer', 'Dryer', 'Range Hood', 'Built-in Oven', 'Wine Fridge', 'Chest Freezer', 'Garburator', 'Water Softener', 'Central Vac'];
const INCLUSION_OPTIONS = ['Window Coverings', 'Light Fixtures', 'Garage Door Opener', 'Hot Tub', 'Pool Equipment', 'Storage Shed', 'ELFs', 'Smart Home Devices', 'Security System', 'Water Treatment System', 'Satellite Dish', 'TV Wall Mount(s)'];
const FOUNDATION_TYPES = ['Poured Concrete', 'Block', 'Stone', 'Slab', 'Crawl Space', 'Pier / Post', 'Other'];
const ROOF_TYPES = ['Asphalt Shingle', 'Metal', 'Cedar Shake', 'Slate', 'Flat / Torch-On', 'Tile', 'Other'];
const PROPERTY_TYPES = ['Detached', 'Semi-Detached', 'Townhouse', 'Condo', 'Bungalow', 'Multi-Family', 'Vacant Land', 'Farm', 'Cottage / Waterfront', 'Commercial', 'Other'];
const BASEMENT_TYPES = ['Full', 'Partial', 'Crawl Space', 'None'];
const WATER_SOURCES = ['Municipal', 'Drilled Well', 'Dug Well', 'Lake', 'Shared Well', 'Cistern'];
const SEWER_TYPES = ['Municipal Sewer', 'Septic Tank', 'Holding Tank', 'Septic Bed'];
const GARAGE_TYPES = ['Attached', 'Detached', 'Built-In', 'Carport', 'None'];
const FLOORING_TYPES = ['Hardwood', 'Laminate', 'Vinyl Plank', 'Tile', 'Carpet', 'Concrete', 'Other'];

function defaultFormData() {
  return {
    propertyId: '', address: '', city: 'Midland', postalCode: '',
    mlsNumber: '', listPrice: '', propertyType: '', lotSize: '', lotDimensions: '',
    lotFrontage: '', lotDepth: '',
    taxes: '', taxYear: '', assessedValue: '',
    sellerName: '', sellerPhone: '', sellerEmail: '',
    sellerName2: '', sellerPhone2: '', sellerEmail2: '', occupancy: '',
    bedrooms: '', bathrooms: '',
    style: '', foundationType: '', roofType: '', roofAge: '', exteriorMaterial: '',
    sqftAboveGrade: '', sqftBelowGrade: '', totalFinishedSqFt: '',
    plumbing: 'Standard', electricalAmps: '', electricalType: '',
    heatingTypes: [], furnaceAge: '', furnaceOwnedRented: '', acTypes: [],
    hasFireplace: false, fireplaceType: '', numberOfFireplaces: '',
    hotWaterType: '', hotWaterAge: '', hotWaterOwnedRented: '', rentalItems: '',
    hydroProvider: '', propaneProvider: '', gasProvider: '', internetProvider: '', internetType: '',
    basementType: '', basementFinish: '', basementWalkout: '', basementCeilingHeight: '', basementNotes: '',
    waterSource: '', sewerType: '', wellDetails: '', septicDetails: '',
    garageType: '', garageSpaces: '', drivewaySize: '', drivewayMaterial: '', drivewaySpaces: '',
    appliancesIncluded: [],
    otherInclusions: [], inclusionsNotes: '', exclusions: '',
    hasPool: false, poolType: '', hasHotTub: false,
    visibleUpgrades: '', hiddenUpgrades: '', floorPlanChanges: '',
    rooms: [],
    isWaterfront: false, waterfrontType: '', waterBody: '', waterBodyType: '', waterfrontFootage: '',
    shoreline: '', shorelineExposure: '', dock: '', waterDepth: '',
    waterfrontFeatures: '', waterfrontAccessoryBuildings: '',
    lockboxCode: '', accessNotes: '', showingRestrictions: '', showingInstructions: '',
    signType: '', signLocation: '', riderInfo: '',
    stagingNotes: '', photographyNotes: '',
    additionalNotes: '',
    top5Reasons: '', mlsDescription: '',
    fintracId1Type: '', fintracId1Number: '', fintracId1Expiry: '',
    fintracEmployer: '', fintracOccupation: '',
    status: 'draft', createdAt: '', updatedAt: '',
  };
}

function ChipSelect({ options, selected, onChange, color = '#c8a96e' }) {
  const toggle = (opt) => {
    const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt];
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const active = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: active ? 600 : 400,
            border: `1.5px solid ${active ? color : '#d1d5db'}`,
            background: active ? color : '#fff', color: active ? '#fff' : '#374151',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>{opt}</button>
        );
      })}
    </div>
  );
}

function FormField({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

function FormSection({ title, icon: Icon, expanded, onToggle, children, badge }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer',
        background: expanded ? '#fafafa' : '#fff', borderBottom: expanded ? '1px solid #e5e7eb' : 'none',
        transition: 'background 0.15s',
      }}>
        {Icon && <Icon size={16} color="#c8a96e" />}
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', flex: 1 }}>{title}</span>
        {badge && <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: '#c8a96e', padding: '2px 8px', borderRadius: 10 }}>{badge}</span>}
        {expanded ? <ChevronUp size={16} color="#9ca3af" /> : <ChevronDown size={16} color="#9ca3af" />}
      </div>
      {expanded && <div style={{ padding: '16px 18px' }}>{children}</div>}
    </div>
  );
}

const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, color: '#111827', background: '#fafafa', outline: 'none', boxSizing: 'border-box' };
const selectStyle = { ...inputStyle, appearance: 'auto' };
const textareaStyle = { ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' };
const gridStyle = (cols = 3) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '12px 16px' });

function ListingForm() {
  const [properties, setProperties] = useState([]);
  const [activePropertyId, setActivePropertyId] = useState(null);
  const [form, setForm] = useState(defaultFormData());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [expanded, setExpanded] = useState({ property: true, seller: true });
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const geoFileRef = useRef(null);
  const mlsFileRef = useRef(null);
  const saveTimerRef = useRef(null);

  const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const updateField = (field, value) => {
    setForm(p => ({ ...p, [field]: value }));
    setDirty(true);
    // Auto-save after 3 seconds of inactivity
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveForm({ ...form, [field]: value }); }, 3000);
  };

  const fetchProperties = async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/listing-form/list');
      const data = await res.json();
      if (data.success) setProperties(data.listings || []);
    } catch (err) { console.error('Failed to load listings:', err); }
    setLoadingList(false);
  };

  const loadProperty = async (propertyId) => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/listing-form/load/${propertyId}`);
      const data = await res.json();
      if (data.success && data.data) {
        // Merge with defaults to ensure all fields exist
        setForm({ ...defaultFormData(), ...data.data });
        setActivePropertyId(propertyId);
        setDirty(false);
        setLastSaved(data.data.updatedAt || null);
      }
    } catch (err) { console.error('Failed to load listing:', err); }
    setLoading(false);
  };

  const saveForm = async (formData) => {
    const data = formData || form;
    if (!data.address && !data.propertyId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/listing-form/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) {
        if (result.propertyId && !activePropertyId) setActivePropertyId(result.propertyId);
        if (result.propertyId) setForm(p => ({ ...p, propertyId: result.propertyId }));
        setDirty(false);
        setLastSaved(new Date().toISOString());
        fetchProperties(); // refresh list
      }
    } catch (err) { console.error('Failed to save:', err); }
    setSaving(false);
  };

  const createNew = () => {
    setForm(defaultFormData());
    setActivePropertyId(null);
    setDirty(false);
    setLastSaved(null);
    setExpanded({ property: true, seller: true });
  };

  const deleteProperty = async (propertyId) => {
    if (!confirm(`Delete listing ${propertyId}?`)) return;
    try {
      await fetch(`/api/listing-form/${propertyId}`, { method: 'DELETE' });
      if (activePropertyId === propertyId) createNew();
      fetchProperties();
    } catch {}
  };

  const addRoom = () => {
    const rooms = [...(form.rooms || []), { name: '', level: 'Main', dimensions: '', flooring: '', features: '' }];
    updateField('rooms', rooms);
  };

  const updateRoom = (idx, field, value) => {
    const rooms = [...(form.rooms || [])];
    rooms[idx] = { ...rooms[idx], [field]: value };
    updateField('rooms', rooms);
  };

  const removeRoom = (idx) => {
    const rooms = (form.rooms || []).filter((_, i) => i !== idx);
    updateField('rooms', rooms);
  };

  // ─── PDF IMPORT ───
  const handlePdfImport = async (file, type) => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('type', type);
      const res = await fetch('/api/listing-form/import-pdf', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.fields) {
        // Merge imported fields into form — only overwrite empty fields (unless GeoWarehouse which takes priority)
        const isGeo = data.type === 'geowarehouse';
        setForm(prev => {
          const merged = { ...prev };
          for (const [key, val] of Object.entries(data.fields)) {
            if (key === '_source') continue;
            if (val === null || val === undefined || val === '') continue;
            // GeoWarehouse always overwrites. MLS only fills empty fields.
            if (isGeo || !merged[key] || (typeof merged[key] === 'string' && !merged[key].trim()) || (Array.isArray(merged[key]) && merged[key].length === 0)) {
              merged[key] = val;
            }
          }
          return merged;
        });
        setDirty(true);
        setImportResult({ success: true, type: data.type, count: data.fieldCount });
        // Auto-expand relevant sections
        if (isGeo) setExpanded(p => ({ ...p, property: true, seller: true }));
        else setExpanded(p => ({ ...p, property: true, structure: true, heating: true, rooms: true }));
        setTimeout(() => setImportResult(null), 5000);
      } else {
        setImportResult({ success: false, error: data.error || 'Import failed' });
        setTimeout(() => setImportResult(null), 5000);
      }
    } catch (err) {
      setImportResult({ success: false, error: err.message });
      setTimeout(() => setImportResult(null), 5000);
    }
    setImporting(false);
  };

  // ─── SEND PRE-LISTING FORM TO SELLER VIA FUB ───
  const sendToSellerViaFUB = () => {
    // Build the pre-listing form URL with property details
    const params = new URLSearchParams();
    if (form.propertyId) params.set('id', form.propertyId);
    if (form.address) params.set('address', form.address);
    if (form.city) params.set('city', form.city);
    if (form.postalCode) params.set('postal', form.postalCode);
    if (form.sellerName) params.set('seller', form.sellerName);
    const formLink = `https://jonathanwallace.ca/listing-form?${params.toString()}`;

    // Search FUB for the seller by name or email
    const sellerName = form.sellerName || 'the seller';
    const firstName = sellerName.split(' ')[0] || 'there';

    const emailBody = `Hi ${firstName},\n\nThank you for choosing to work with me on the sale of ${form.address || 'your home'}${form.city ? `, ${form.city}` : ''}.\n\nTo make sure I have all the details I need to effectively market your property, I've put together a quick pre-listing questionnaire for you. It covers the basics — things like heating, utilities, upgrades, and what's included in the sale.\n\nYou can fill it out at your convenience here:\n${formLink}\n\nYour answers help me build the most accurate and compelling listing possible. If you have any questions while filling it out, don't hesitate to reach out.\n\nLooking forward to getting started!\n\nJonathan Wallace\nFaris Team Real Estate Brokerage\n705-433-2525`;

    const emailSubject = `Pre-Listing Questionnaire — ${form.address || 'Your Home'}${form.city ? `, ${form.city}` : ''}`;

    // If we have a seller email, open FUB compose directly
    if (form.sellerEmail) {
      window.open(`https://app.followupboss.com/app/inbox/compose?to=${encodeURIComponent(form.sellerEmail)}&subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`, '_blank');
    } else {
      // Fallback: open FUB with search for seller name
      const mailto = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
      window.open(mailto, '_blank');
    }
  };

  useEffect(() => { fetchProperties(); }, []);

  // Auto-generate propertyId when address changes
  useEffect(() => {
    if (!activePropertyId && form.address && form.address.length > 3) {
      const slug = form.address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const city = (form.city || 'midland').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setForm(p => ({ ...p, propertyId: `${slug}-${city}`.slice(0, 80) }));
    }
  }, [form.address, form.city, activePropertyId]);

  const inp = (field, placeholder) => (
    <input style={inputStyle} value={form[field] || ''} onChange={e => updateField(field, e.target.value)} placeholder={placeholder} />
  );
  const sel = (field, options, placeholder) => (
    <select style={selectStyle} value={form[field] || ''} onChange={e => updateField(field, e.target.value)}>
      <option value="">{placeholder || 'Select...'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const ta = (field, placeholder) => (
    <textarea style={textareaStyle} value={form[field] || ''} onChange={e => updateField(field, e.target.value)} placeholder={placeholder} />
  );

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* HEADER BAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <ClipboardList size={22} color="#c8a96e" />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Listing Form</h2>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Pre-listing questionnaire & appointment checklist</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastSaved && <span style={{ fontSize: 10, color: '#9ca3af' }}>Saved {new Date(lastSaved).toLocaleTimeString()}</span>}
          {saving && <Loader2 size={14} color="#c8a96e" style={{ animation: 'spin 1s linear infinite' }} />}
          {dirty && <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>Unsaved</span>}
          <button onClick={() => saveForm()} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
            background: '#c8a96e', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}><Save size={13} /> Save</button>
        </div>
      </div>

      {/* PROPERTY SELECTOR */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 16, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Home size={16} color="#6b7280" />
        <select style={{ ...selectStyle, flex: 1 }} value={activePropertyId || ''} onChange={e => e.target.value ? loadProperty(e.target.value) : createNew()}>
          <option value="">+ New Listing</option>
          {properties.map(p => (
            <option key={p.propertyId} value={p.propertyId}>
              {p.address || p.propertyId}{p.city ? `, ${p.city}` : ''}{p.listPrice ? ` — $${Number(p.listPrice).toLocaleString()}` : ''}{p.status === 'active' ? ' ✓' : ''}
            </option>
          ))}
        </select>
        <button onClick={createNew} title="New listing" style={{
          width: 34, height: 34, borderRadius: 8, border: '1px solid #d1d5db', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}><Plus size={16} color="#6b7280" /></button>
        {activePropertyId && <button onClick={() => deleteProperty(activePropertyId)} title="Delete listing" style={{
          width: 34, height: 34, borderRadius: 8, border: '1px solid #fca5a5', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}><Trash size={14} color="#ef4444" /></button>}
      </div>

      {/* IMPORT & ACTIONS TOOLBAR */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Import:</span>

        {/* Hidden file inputs */}
        <input ref={geoFileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handlePdfImport(e.target.files[0], 'geowarehouse'); e.target.value = ''; }} />
        <input ref={mlsFileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handlePdfImport(e.target.files[0], 'listing'); e.target.value = ''; }} />

        <button onClick={() => geoFileRef.current?.click()} disabled={importing} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #059669', background: '#ecfdf5', color: '#059669',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}><FileText size={13} /> GeoWarehouse PDF</button>

        <button onClick={() => mlsFileRef.current?.click()} disabled={importing} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}><FileText size={13} /> REALM / MLS Listing</button>

        {importing && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Parsing PDF...</span>}

        {importResult && (
          <span style={{ fontSize: 11, fontWeight: 600, color: importResult.success ? '#059669' : '#ef4444', background: importResult.success ? '#ecfdf5' : '#fef2f2', padding: '4px 10px', borderRadius: 6 }}>
            {importResult.success ? `Imported ${importResult.count} fields from ${importResult.type === 'geowarehouse' ? 'GeoWarehouse' : 'MLS listing'}` : importResult.error}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Send pre-listing form to seller */}
        <button onClick={sendToSellerViaFUB} title="Draft email to seller with pre-listing form link" style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #c8a96e', background: '#fffbf0', color: '#92730a',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}><Send size={13} /> Send Form to Seller</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 8, fontSize: 13 }}>Loading listing...</p>
        </div>
      ) : (
        <>
          {/* SECTION 1: PROPERTY INFORMATION */}
          <FormSection title="Property Information" icon={Home} expanded={expanded.property} onToggle={() => toggle('property')}>
            <div style={gridStyle(3)}>
              <FormField label="Street Address" span={2}>{inp('address', '123 Main Street')}</FormField>
              <FormField label="City / Town">{inp('city', 'Midland')}</FormField>
              <FormField label="Postal Code">{inp('postalCode', 'L4R 1A1')}</FormField>
              <FormField label="Property Type">{sel('propertyType', PROPERTY_TYPES, 'Select type...')}</FormField>
              <FormField label="Year Built">{inp('yearBuilt', '')}</FormField>
              <FormField label="Lot Size (Acreage)">{inp('lotSize', '0.50 acres')}</FormField>
              <FormField label="Lot Dimensions">{inp('lotDimensions', '50 x 120')}</FormField>
              <FormField label="Lot Frontage (ft)">{inp('lotFrontage', '')}</FormField>
              <FormField label="Lot Depth (ft)">{inp('lotDepth', '')}</FormField>
              <FormField label="Taxes (Annual)">{inp('taxes', '3,200')}</FormField>
              <FormField label="Tax Year">{inp('taxYear', '2025')}</FormField>
              <FormField label="Assessed Value">{inp('assessedValue', '')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 2: SELLER INFORMATION */}
          <FormSection title="Seller Information" icon={Users} expanded={expanded.seller} onToggle={() => toggle('seller')}>
            <div style={gridStyle(3)}>
              <FormField label="Seller 1 — Full Name">{inp('sellerName', 'John Smith')}</FormField>
              <FormField label="Phone">{inp('sellerPhone', '705-555-0123')}</FormField>
              <FormField label="Email">{inp('sellerEmail', 'john@email.com')}</FormField>
              <FormField label="Seller 2 — Full Name">{inp('sellerName2', '')}</FormField>
              <FormField label="Phone">{inp('sellerPhone2', '')}</FormField>
              <FormField label="Email">{inp('sellerEmail2', '')}</FormField>
              <FormField label="Occupancy Status">{sel('occupancy', ['Owner Occupied', 'Tenant Occupied', 'Vacant', 'Seasonal'], 'Select...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 3: BEDROOMS & BATHROOMS */}
          <FormSection title="Bedrooms & Bathrooms" icon={Home} expanded={expanded.beds} onToggle={() => toggle('beds')}>
            <div style={gridStyle(4)}>
              <FormField label="Bedrooms">{sel('bedrooms', ['1','2','3','4','5','6+'], 'Select...')}</FormField>
              <FormField label="Bathrooms">{sel('bathrooms', ['1','1.5','2','2.5','3','3.5','4','4.5','5+'], 'Select...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 4: STRUCTURE & FOUNDATION */}
          <FormSection title="Structure & Foundation" icon={Home} expanded={expanded.structure} onToggle={() => toggle('structure')}>
            <div style={gridStyle(3)}>
              <FormField label="Style">{inp('style', 'e.g. 2-Storey, Bungalow, Split-Level')}</FormField>
              <FormField label="Foundation Type">{sel('foundationType', FOUNDATION_TYPES, 'Select...')}</FormField>
              <FormField label="Exterior Material">{inp('exteriorMaterial', 'e.g. Brick, Vinyl Siding, Stone')}</FormField>
              <FormField label="Roof Type">{sel('roofType', ROOF_TYPES, 'Select...')}</FormField>
              <FormField label="Roof Age (years)">{inp('roofAge', '')}</FormField>
              <FormField label="Sq Ft — Above Grade">{inp('sqftAboveGrade', '')}</FormField>
              <FormField label="Sq Ft — Below Grade">{inp('sqftBelowGrade', '')}</FormField>
              <FormField label="Total Finished Sq Ft">{inp('totalFinishedSqFt', '')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 5: PLUMBING & ELECTRICAL */}
          <FormSection title="Plumbing & Electrical" icon={Zap} expanded={expanded.electrical} onToggle={() => toggle('electrical')}>
            <div style={gridStyle(3)}>
              <FormField label="Plumbing">{sel('plumbing', ['Standard', 'Copper', 'PEX', 'Galvanized', 'Mixed', 'Other'], 'Select...')}</FormField>
              <FormField label="Panel Amps">{sel('electricalAmps', ['60', '100', '200', '400'], 'Select...')}</FormField>
              <FormField label="Breakers or Fuses">{sel('electricalType', ['Breakers', 'Fuses', 'Mixed'], 'Select...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 6: HEATING & AIR CONDITIONING */}
          <FormSection title="Heating & Air Conditioning" icon={Flame} expanded={expanded.heating} onToggle={() => toggle('heating')} badge={form.heatingTypes.length > 0 ? form.heatingTypes.length : null}>
            <FormField label="Heating Type(s)">
              <ChipSelect options={HEATING_OPTIONS} selected={form.heatingTypes || []} onChange={v => updateField('heatingTypes', v)} />
            </FormField>
            <div style={{ ...gridStyle(3), marginTop: 14 }}>
              <FormField label="Furnace Age (years)">{inp('furnaceAge', '')}</FormField>
              <FormField label="Furnace Owned / Rented">{sel('furnaceOwnedRented', ['Owned', 'Rented'], 'Select...')}</FormField>
            </div>
            <div style={{ marginTop: 14 }}>
              <FormField label="Air Conditioning">
                <ChipSelect options={AC_OPTIONS} selected={form.acTypes || []} onChange={v => updateField('acTypes', v)} />
              </FormField>
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e5e7eb' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
                <input type="checkbox" checked={form.hasFireplace || false} onChange={e => updateField('hasFireplace', e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Fireplace</span>
              </label>
              {form.hasFireplace && (
                <div style={gridStyle(3)}>
                  <FormField label="Fireplace Type">{sel('fireplaceType', ['Wood', 'Propane', 'Gas', 'Electric'], 'Select...')}</FormField>
                  <FormField label="Number of Fireplaces">{sel('numberOfFireplaces', ['1','2','3','4'], 'Select...')}</FormField>
                </div>
              )}
            </div>
          </FormSection>

          {/* SECTION 7: HOT WATER */}
          <FormSection title="Hot Water Tank" icon={Snowflake} expanded={expanded.hotwater} onToggle={() => toggle('hotwater')}>
            <div style={gridStyle(3)}>
              <FormField label="Type">{sel('hotWaterType', ['Tank — Gas', 'Tank — Electric', 'Tank — Propane', 'Tankless — Gas', 'Tankless — Electric', 'On-Demand'], 'Select...')}</FormField>
              <FormField label="Age (years)">{inp('hotWaterAge', '')}</FormField>
              <FormField label="Owned / Rented">{sel('hotWaterOwnedRented', ['Owned', 'Rented'], 'Select...')}</FormField>
              <FormField label="Other Rental Items" span={3}>{inp('rentalItems', 'e.g. Water softener, HVAC, propane tank')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 8: UTILITIES */}
          <FormSection title="Utility & Service Providers" icon={Zap} expanded={expanded.utilities} onToggle={() => toggle('utilities')}>
            <div style={gridStyle(3)}>
              <FormField label="Hydro Provider">{inp('hydroProvider', 'e.g. Midland Power')}</FormField>
              <FormField label="Propane Provider">{inp('propaneProvider', '')}</FormField>
              <FormField label="Gas Provider">{inp('gasProvider', 'e.g. Enbridge')}</FormField>
              <FormField label="Internet Provider">{inp('internetProvider', 'e.g. Bell, Rogers')}</FormField>
              <FormField label="Internet Type">{sel('internetType', ['Fibre', 'Cable', 'DSL', 'Fixed Wireless', 'Satellite', 'Starlink'], 'Select...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 9: WATER & SEWER */}
          <FormSection title="Water & Sewer" icon={Snowflake} expanded={expanded.water} onToggle={() => toggle('water')}>
            <div style={gridStyle(3)}>
              <FormField label="Water Source">{sel('waterSource', WATER_SOURCES, 'Select...')}</FormField>
              <FormField label="Sewer Type">{sel('sewerType', SEWER_TYPES, 'Select...')}</FormField>
              <FormField label="Well Details">{inp('wellDetails', 'Depth, GPM, last test')}</FormField>
              <FormField label="Septic Details" span={2}>{inp('septicDetails', 'Age, last pump, size')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 10: BASEMENT */}
          <FormSection title="Basement" icon={Home} expanded={expanded.basement} onToggle={() => toggle('basement')}>
            <div style={gridStyle(3)}>
              <FormField label="Basement Type">{sel('basementType', BASEMENT_TYPES, 'Select...')}</FormField>
              <FormField label="Finish Level">{sel('basementFinish', ['Finished', 'Partially Finished', 'Unfinished'], 'Select...')}</FormField>
              <FormField label="Walkout">{sel('basementWalkout', ['Yes', 'No'], 'Select...')}</FormField>
              <FormField label="Ceiling Height">{inp('basementCeilingHeight', "e.g. 7'6\"")}</FormField>
              <FormField label="Basement Notes" span={2}>{inp('basementNotes', 'Key features, separate entrance, etc.')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 11: PARKING & GARAGE */}
          <FormSection title="Parking & Garage" icon={Home} expanded={expanded.parking} onToggle={() => toggle('parking')}>
            <div style={gridStyle(3)}>
              <FormField label="Garage Type">{sel('garageType', GARAGE_TYPES, 'Select...')}</FormField>
              <FormField label="Garage Spaces">{sel('garageSpaces', ['1','2','3','4','5'], 'Select...')}</FormField>
              <FormField label="Driveway Size">{inp('drivewaySize', 'e.g. Single, Double, Triple')}</FormField>
              <FormField label="Driveway Material">{inp('drivewayMaterial', 'e.g. Paved, Gravel, Interlocking')}</FormField>
              <FormField label="Driveway Parking Spaces">{sel('drivewaySpaces', ['1','2','3','4','5','6','7','8','9','10+'], 'Select...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 12: APPLIANCES */}
          <FormSection title="Appliances Included" icon={CheckCircle2} expanded={expanded.appliances} onToggle={() => toggle('appliances')} badge={form.appliancesIncluded.length > 0 ? form.appliancesIncluded.length : null}>
            <ChipSelect options={APPLIANCE_OPTIONS} selected={form.appliancesIncluded || []} onChange={v => updateField('appliancesIncluded', v)} />
          </FormSection>

          {/* SECTION 13: OTHER INCLUSIONS */}
          <FormSection title="Other Inclusions" icon={CheckCircle2} expanded={expanded.inclusions} onToggle={() => toggle('inclusions')} badge={form.otherInclusions.length > 0 ? form.otherInclusions.length : null}>
            <ChipSelect options={INCLUSION_OPTIONS} selected={form.otherInclusions || []} onChange={v => updateField('otherInclusions', v)} />
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.hasPool || false} onChange={e => updateField('hasPool', e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Pool</span>
              </label>
              {form.hasPool && (
                <div style={{ marginLeft: 26 }}>
                  <FormField label="Pool Type">{sel('poolType', ['Chlorine', 'Saltwater'], 'Select...')}</FormField>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.hasHotTub || false} onChange={e => updateField('hasHotTub', e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Hot Tub</span>
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <FormField label="Additional Inclusions Notes">{ta('inclusionsNotes', 'Any other items included in the sale...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 14: EXCLUSIONS */}
          <FormSection title="Exclusions" icon={X} expanded={expanded.exclusions} onToggle={() => toggle('exclusions')}>
            <FormField label="Items Excluded from Sale">{ta('exclusions', 'List any items the seller is taking with them...')}</FormField>
          </FormSection>

          {/* SECTION 15: ROOM-BY-ROOM */}
          <FormSection title="Room-by-Room Details" icon={Home} expanded={expanded.rooms} onToggle={() => toggle('rooms')} badge={form.rooms && form.rooms.length > 0 ? form.rooms.length : null}>
            {(form.rooms || []).map((room, idx) => (
              <div key={idx} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280' }}>ROOM {idx + 1}</span>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => removeRoom(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                    <X size={14} color="#ef4444" />
                  </button>
                </div>
                <div style={gridStyle(4)}>
                  <FormField label="Room Name">
                    <input style={inputStyle} value={room.name} onChange={e => updateRoom(idx, 'name', e.target.value)} placeholder="e.g. Primary Bedroom" />
                  </FormField>
                  <FormField label="Level">
                    <select style={selectStyle} value={room.level} onChange={e => updateRoom(idx, 'level', e.target.value)}>
                      {['Main', 'Upper', 'Lower', 'Basement'].map(l => <option key={l}>{l}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Dimensions">
                    <input style={inputStyle} value={room.dimensions} onChange={e => updateRoom(idx, 'dimensions', e.target.value)} placeholder="12 x 14" />
                  </FormField>
                  <FormField label="Flooring">
                    <select style={selectStyle} value={room.flooring || ''} onChange={e => updateRoom(idx, 'flooring', e.target.value)}>
                      <option value="">Select...</option>
                      {FLOORING_TYPES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </FormField>
                </div>
                <div style={{ marginTop: 8 }}>
                  <FormField label="Features / Notes">
                    <input style={inputStyle} value={room.features} onChange={e => updateRoom(idx, 'features', e.target.value)} placeholder="Walk-in closet, ensuite, bay window..." />
                  </FormField>
                </div>
              </div>
            ))}
            <button type="button" onClick={addRoom} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8,
              border: '1.5px dashed #d1d5db', background: '#fff', fontSize: 12, fontWeight: 600,
              color: '#6b7280', cursor: 'pointer', width: '100%', justifyContent: 'center',
            }}><Plus size={14} /> Add Room</button>
          </FormSection>

          {/* SECTION 16: UPGRADES & RENOVATIONS */}
          <FormSection title="Recent Upgrades & Renovations" icon={Star} expanded={expanded.upgrades} onToggle={() => toggle('upgrades')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="Visible Upgrades (kitchen, bathrooms, flooring, windows, etc.)">{ta('visibleUpgrades', 'List upgrades that buyers will notice...')}</FormField>
              <FormField label="Hidden Upgrades (plumbing, electrical, insulation, foundation, etc.)">{ta('hiddenUpgrades', 'List upgrades behind the walls...')}</FormField>
              <FormField label="Floor Plan Changes">{ta('floorPlanChanges', 'Were any walls removed, rooms added, or layout changes made?')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 17: WATERFRONT */}
          <FormSection title="Waterfront Details" icon={Snowflake} expanded={expanded.waterfront} onToggle={() => toggle('waterfront')} badge={form.isWaterfront ? 'YES' : null}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isWaterfront || false} onChange={e => updateField('isWaterfront', e.target.checked)} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>This is a waterfront property</span>
              </label>
            </div>
            {form.isWaterfront && (
              <div style={gridStyle(3)}>
                <FormField label="Waterfront Type">{sel('waterfrontType', ['Lake', 'River', 'Bay', 'Ocean', 'Pond', 'Creek'], 'Select...')}</FormField>
                <FormField label="Water Body Name">{inp('waterBody', 'e.g. Georgian Bay, Lake Simcoe')}</FormField>
                <FormField label="Water Body Type">{sel('waterBodyType', ['Lake', 'River', 'Bay', 'Pond', 'Creek', 'Canal'], 'Select...')}</FormField>
                <FormField label="Waterfront Footage (ft)">{inp('waterfrontFootage', '')}</FormField>
                <FormField label="Shoreline Type">{sel('shoreline', ['Sandy', 'Rocky', 'Gradual', 'Steep', 'Marsh', 'Mixed'], 'Select...')}</FormField>
                <FormField label="Shoreline Exposure">{sel('shorelineExposure', ['North', 'South', 'East', 'West', 'NE', 'NW', 'SE', 'SW'], 'Select...')}</FormField>
                <FormField label="Dock / Docking Type">{sel('dock', ['Floating', 'Permanent', 'Boathouse', 'Marina', 'Municipal', 'None'], 'Select...')}</FormField>
                <FormField label="Water Depth">{inp('waterDepth', 'e.g. Shallow, Deep, Gradual entry')}</FormField>
                <FormField label="Waterfront Features" span={2}>{inp('waterfrontFeatures', 'e.g. Boat launch, swim area, sunset views')}</FormField>
                <FormField label="Accessory Buildings">{inp('waterfrontAccessoryBuildings', 'e.g. Bunkie, Boathouse, Shed')}</FormField>
              </div>
            )}
          </FormSection>

          {/* SECTION 18: FINTRAC */}
          <FormSection title="FINTRAC — Identity Verification" icon={FileText} expanded={expanded.fintrac} onToggle={() => toggle('fintrac')}>
            <div style={gridStyle(3)}>
              <FormField label="ID Type">{sel('fintracId1Type', ["Driver's License", 'Passport', 'Health Card', 'Other Government ID'], 'Select...')}</FormField>
              <FormField label="ID Number">{inp('fintracId1Number', '')}</FormField>
              <FormField label="Expiry Date">{inp('fintracId1Expiry', 'YYYY-MM-DD')}</FormField>
              <FormField label="Occupation">{inp('fintracOccupation', '')}</FormField>
              <FormField label="Employer">{inp('fintracEmployer', '')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 19: SHOWING INSTRUCTIONS */}
          <FormSection title="Showing Instructions" icon={MapPin} expanded={expanded.showing} onToggle={() => toggle('showing')}>
            <div style={gridStyle(3)}>
              <FormField label="Lockbox Code">{inp('lockboxCode', '')}</FormField>
              <FormField label="Access Notes">{inp('accessNotes', 'e.g. Key under mat, ring doorbell')}</FormField>
              <FormField label="Restrictions">{inp('showingRestrictions', 'e.g. 24hr notice, no Sundays')}</FormField>
            </div>
            <div style={{ marginTop: 12 }}>
              <FormField label="Showing Instructions" span={3}>{ta('showingInstructions', 'Detailed instructions for agents showing the property...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 19b: STAGING & PHOTOGRAPHY NOTES */}
          <FormSection title="Staging & Photography Notes" icon={Star} expanded={expanded.staging} onToggle={() => toggle('staging')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="Notes for Staging">{ta('stagingNotes', 'Client situation, background info, sensitive details, special requests...')}</FormField>
              <FormField label="Notes for Photography">{ta('photographyNotes', 'Specific rooms to highlight, recent renovations, WOW features, angles to capture...')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 20: SIGNAGE */}
          <FormSection title="Signage" icon={Flag} expanded={expanded.signage} onToggle={() => toggle('signage')}>
            <div style={gridStyle(3)}>
              <FormField label="Sign Type">{sel('signType', ['Post Sign', 'A-Frame', 'Both', 'None'], 'Select...')}</FormField>
              <FormField label="Sign Location">{inp('signLocation', 'e.g. Front lawn, corner lot')}</FormField>
              <FormField label="Rider Info">{inp('riderInfo', 'e.g. SOLD, OPEN HOUSE, NEW PRICE')}</FormField>
            </div>
          </FormSection>

          {/* SECTION 21: ADDITIONAL NOTES */}
          <FormSection title="Additional Notes" icon={PenLine} expanded={expanded.notes} onToggle={() => toggle('notes')}>
            <FormField label="Anything else to note about this property">{ta('additionalNotes', 'Additional details, special circumstances, seller preferences...')}</FormField>
          </FormSection>

          {/* SECTION 22: AI-GENERATED CONTENT */}
          <FormSection title="AI-Generated Marketing" icon={Sparkles} expanded={expanded.ai} onToggle={() => toggle('ai')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="Top 5 Reasons to Love This Home">{ta('top5Reasons', 'Click "Generate" to auto-create from property details...')}</FormField>
              <FormField label="MLS Description">{ta('mlsDescription', 'Click "Generate" to auto-create from property details...')}</FormField>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={{
                  padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(135deg, #c8a96e, #d4b878)',
                  color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}><Sparkles size={13} /> Generate Top 5</button>
                <button type="button" style={{
                  padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(135deg, #c8a96e, #d4b878)',
                  color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}><Sparkles size={13} /> Generate MLS Description</button>
              </div>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>AI generation will use all filled-in property details above to create marketing content.</p>
            </div>
          </FormSection>

          {/* BOTTOM SAVE BAR */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 0', marginTop: 8 }}>
            {dirty && <span style={{ fontSize: 11, color: '#f59e0b', alignSelf: 'center' }}>Unsaved changes</span>}
            <button onClick={() => saveForm()} disabled={saving} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 8,
              background: saving ? '#9ca3af' : '#c8a96e', color: '#fff', border: 'none',
              fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
            }}>{saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving...' : 'Save Listing'}</button>
          </div>
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// SECTION ROUTER
// ─────────────────────────────────────────────
function SectionContent({ section }) {
  switch (section) {
    case "briefing": return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

        {/* Gmail Intelligence — live sent mail tracking + BrokerBay cross-reference */}
        <GmailActivityPanel />
      </div>
    );
    case "priorities": return <TopPriorities />;
    case "calls": return <CallListSection />;
    case "emails": return (<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><EmailEASection /><GmailActivityPanel /></div>);
    case "calendar": return <CalendarSection />;
    case "showings": return <ShowingsSection />;
    case "crm": return <PlaceholderSection title="Follow Up Boss — Deal Pipeline" icon={Users} />;
    case "tj-import": return <TeamJordanImport />;
    case "leadgen": return <PlaceholderSection title="Lead Gen" icon={Target} />;
    case "pnl": return <PnlSection />;
    case "personal": return <PlaceholderSection title="Personal" icon={User} />;
    case "workout": return <PlaceholderSection title="Workout" icon={Dumbbell} />;
    case "meals": return <PlaceholderSection title="Meals" icon={UtensilsCrossed} />;
    case "marketing": return <MarketingSection />;
    case "learning": return <PlaceholderSection title="Learning" icon={BookOpen} />;
    case "listing-form": return <ListingForm />;
    case "sellers": return <SellersSection />;
    case "loo": return <PlaceholderSection title="LOO" icon={FileText} />;
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
      if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed) && parsed.length) return parsed; }
    } catch {}
    return sidebarItems.map(i => i.id);
  });
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // FUB call list — shared via context
  const fubData = useFubCallList();

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
        <div style={{ background: "#fff", padding: "10px 24px", display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", flexShrink: 0, position: "relative" }}>
          {/* Center — Logo + Date */}
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <img src="/agent-hq-logo.png" alt="Agent HQ" style={{ height: 50, objectFit: "contain" }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginTop: 2 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
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
          {/* Hour of Power — always visible */}
          <HourOfPowerBar />

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
    </FubContext.Provider>
  );
}
