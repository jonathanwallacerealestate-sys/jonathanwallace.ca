// src/components/ListingForm.jsx
//
// The deal-card / pre-listing-questionnaire UI for Agent HQ.
// Extracted verbatim from App.jsx 2026-04-24 — no behavior change.
//
// Internal state, autosave-to-disk, FUB sync, photo extract, Sisu push,
// Print/PDF — all of it lives here now.
//
// If you need to edit option lists (heating types, roof types, etc.),
// they live in ../config/listing-form-options.js. The shared form
// helpers (FormSection, FormField, ChipSelect, defaultFormData) live in
// ./form-helpers.jsx. The shared styles live in ./form-styles.js.

import { useState, useEffect, useRef } from 'react';
import {
  ArrowUpRight, Bell, CheckCircle2, ChevronDown, ChevronRight,
  ClipboardList, ExternalLink, FileText, Flag, Flame, Home, Loader2,
  MapPin, PenLine, Phone, Play, Plus, RotateCcw, Save, Search, Send,
  Snowflake, Sparkles, Star, Trash, Users, X, Zap,
} from 'lucide-react';

import {
  AC_OPTIONS, APPLIANCE_OPTIONS, BASEMENT_TYPES, ELECTRICAL_AMP_OPTIONS,
  ELECTRICAL_TYPE_OPTIONS, FLOORING_TYPES, FOUNDATION_TYPES, GARAGE_TYPES,
  HEATING_OPTIONS, INCLUSION_OPTIONS, PROPERTY_TYPES, ROOF_TYPES, SEWER_TYPES,
  STYLE_OPTIONS, WATER_SOURCES, getRoomDetailOptions,
} from '../config/listing-form-options.js';

import {
  ChipSelect, FormField, FormSection, defaultFormData,
} from './form-helpers.jsx';

import {
  inputStyle, selectStyle, textareaStyle, gridStyle,
} from './form-styles.js';

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
  const [sisuExport, setSisuExport] = useState(null);
  const [fubAppointments, setFubAppointments] = useState([]);
  // Quick-add: small popover triggered by the Plus button next to the selector.
  // Lets Jonathan land an address in the pick list with one click without filling
  // the whole deal card up front.
  const [quickAdd, setQuickAdd] = useState({ open: false, address: '', city: 'Midland', busy: false, error: null });
  const [loadingFub, setLoadingFub] = useState(false);
  const [importingFub, setImportingFub] = useState(null);
  const [appointmentsExpanded, setAppointmentsExpanded] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractResult, setExtractResult] = useState(null);
  const [photosDragOver, setPhotosDragOver] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState({}); // keyed by field name
  const photoFileRef = useRef(null);
  const geoFileRef = useRef(null);
  const mlsFileRef = useRef(null);
  const saveTimerRef = useRef(null);

  const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const updateField = (field, value) => {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    setDirty(true);
    // Mirror to localStorage so a browser refresh / tab switch keeps typed
    // data even before the first server save (which waits for an address).
    try {
      if (!activePropertyId) {
        localStorage.setItem('agenthq.listing-form.draft', JSON.stringify(nextForm));
      }
    } catch {}
    // Auto-save after 3 seconds of inactivity
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveForm(nextForm); }, 3000);
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
        // Server is now source of truth — drop the local draft.
        try { localStorage.removeItem('agenthq.listing-form.draft'); } catch {}
        fetchProperties(); // refresh list
      }
    } catch (err) { console.error('Failed to save:', err); }
    setSaving(false);
  };

  // Quick-add a property to the pick list — minimal payload (address + city),
  // server slugifies a propertyId, refresh the list, then load the new card.
  const quickAddProperty = async () => {
    const address = (quickAdd.address || '').trim();
    if (!address) { setQuickAdd(q => ({ ...q, error: 'Address required' })); return; }
    setQuickAdd(q => ({ ...q, busy: true, error: null }));
    try {
      const res = await fetch('/api/listing-form/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, city: (quickAdd.city || 'Midland').trim() }),
      });
      const result = await res.json();
      if (!result.success) {
        setQuickAdd(q => ({ ...q, busy: false, error: result.error || 'Failed to add' }));
        return;
      }
      await fetchProperties();
      // Open the new card so Jonathan can keep typing details if he wants
      await loadProperty(result.propertyId);
      setQuickAdd({ open: false, address: '', city: 'Midland', busy: false, error: null });
    } catch (err) {
      setQuickAdd(q => ({ ...q, busy: false, error: err.message }));
    }
  };

  const createNew = () => {
    setForm(defaultFormData());
    setActivePropertyId(null);
    setDirty(false);
    setLastSaved(null);
    setExpanded({ property: true, seller: true });
    try { localStorage.removeItem('agenthq.listing-form.draft'); } catch {}
  };

  const deleteProperty = async (propertyId) => {
    if (!confirm(`Delete listing ${propertyId}?`)) return;
    try {
      await fetch(`/api/listing-form/${propertyId}`, { method: 'DELETE' });
      if (activePropertyId === propertyId) createNew();
      fetchProperties();
    } catch {}
  };

  const makeRoom = (name, level = 'Main') => ({ name, level, dimensions: '', flooring: '', features: '', details: [] });

  const addRoom = () => {
    const rooms = [...(form.rooms || []), makeRoom('')];
    updateField('rooms', rooms);
  };

  const generateStandardRooms = () => {
    const existing = form.rooms || [];
    if (existing.length > 0) return; // Don't overwrite existing rooms
    const rooms = [];
    // Always: Kitchen, Living Room, Dining Room
    rooms.push(makeRoom('Kitchen'));
    rooms.push(makeRoom('Living Room'));
    rooms.push(makeRoom('Dining Room'));
    // Bedrooms based on count (default 3 if not set)
    const bedCount = parseInt(form.bedrooms) || 3;
    for (let i = 1; i <= bedCount; i++) {
      rooms.push(makeRoom(i === 1 ? 'Primary Bedroom' : `Bedroom ${i}`, i === 1 ? 'Upper' : 'Upper'));
    }
    // Bathrooms based on count (default 1)
    const bathCount = parseInt(form.bathrooms) || 1;
    for (let i = 1; i <= bathCount; i++) {
      rooms.push(makeRoom(bathCount === 1 ? 'Bathroom' : i === 1 ? 'Primary Bathroom' : `Bathroom ${i}`, i === 1 ? 'Upper' : 'Main'));
    }
    // Always: Mechanical/Utility Room
    rooms.push(makeRoom('Mechanical Room', 'Basement'));
    updateField('rooms', rooms);
  };

  const updateRoom = (idx, field, value) => {
    const rooms = [...(form.rooms || [])];
    rooms[idx] = { ...rooms[idx], [field]: value };
    updateField('rooms', rooms);
  };

  const toggleRoomDetail = (idx, detail) => {
    const rooms = [...(form.rooms || [])];
    const current = rooms[idx].details || [];
    rooms[idx] = { ...rooms[idx], details: current.includes(detail) ? current.filter(d => d !== detail) : [...current, detail] };
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
    // Build the pre-listing form URL — propertyId is the access token.
    // The Agent HQ SPA detects ?seller=PROPERTY_ID at the top of App.jsx
    // and renders the public SellerForm instead of the dashboard.
    if (!form.propertyId) {
      alert('Save the listing first (an address is required) before sending the seller form.');
      return;
    }
    const formLink = `https://hq.jonathanwallace.ca/?seller=${encodeURIComponent(form.propertyId)}`;

    // Search FUB for the seller by name or email
    const sellerName = form.sellerName || 'the seller';
    const firstName = sellerName.split(' ')[0] || 'there';

    const emailBody = `Hi ${firstName},\n\nThank you for choosing to work with me on the sale of ${form.address || 'your home'}${form.city ? `, ${form.city}` : ''}.\n\nTo make sure I have everything I need to market your home properly, I've put together a quick pre-listing questionnaire that covers the things only you would know — utilities, upgrades, what's included in the sale, and a few details about the systems in the home.\n\nIt takes about 10 minutes. Skip any field that doesn't apply (e.g. septic if you're on municipal sewer):\n${formLink}\n\nYour answers come straight back to me and help me build an accurate, compelling listing. Any questions, just reply to this email.\n\nLooking forward to getting your home sold!\n\nJonathan Wallace\nFaris Team Real Estate Brokerage\n705-433-2525`;

    const emailSubject = `Pre-Listing Questionnaire — ${form.address || 'Your Home'}${form.city ? `, ${form.city}` : ''}`;

    // Open the user's default mail client (Mac Mail) with a draft pre-filled.
    // We dropped the old FUB compose deeplink — FUB removed that URL pattern
    // and it now 404s. mailto opens in Mac Mail / Gmail / whatever the user
    // has configured, drops a draft in Drafts, and the user reviews + sends.
    const to = form.sellerEmail || '';
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoUrl;
  };

  // ─── FETCH FUB LISTING APPOINTMENTS ───
  const fetchFubAppointments = async () => {
    setLoadingFub(true);
    try {
      const res = await fetch('/api/fub/listing-appointments');
      const data = await res.json();
      if (data.success) setFubAppointments(data.appointments || []);
    } catch (err) { console.error('Failed to load FUB appointments:', err); }
    setLoadingFub(false);
  };

  // Import a FUB listing appointment → create listing form and load it
  const importFubAppointment = async (appt) => {
    setImportingFub(appt.fubId);
    try {
      const res = await fetch(`/api/fub/listing-appointments/import/${appt.fubId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.propertyId) {
        await fetchProperties(); // refresh list
        await loadProperty(data.propertyId); // load the new form
        // Mark this appointment as having a form now
        setFubAppointments(prev => prev.map(a => a.fubId === appt.fubId ? { ...a, hasListingForm: true } : a));
      }
    } catch (err) { console.error('Failed to import FUB appointment:', err); }
    setImportingFub(null);
  };

  // ─── PHOTOS ───
  const fetchPhotos = async (propertyId) => {
    if (!propertyId) { setPhotos([]); setExtractResult(null); return; }
    setPhotosLoading(true);
    try {
      const res = await fetch(`/api/listing-form/${propertyId}/photos`);
      const data = await res.json();
      if (data.success) {
        setPhotos(data.photos || []);
        setExtractResult(data.extract || null);
      }
    } catch (err) { console.error('Failed to load photos:', err); }
    setPhotosLoading(false);
  };

  const uploadPhotos = async (fileList) => {
    const propertyId = activePropertyId || form.propertyId;
    if (!propertyId) { alert('Save the deal card first (needs an address) before uploading photos.'); return; }
    const files = Array.from(fileList || []).filter(f => /^image\//.test(f.type));
    if (files.length === 0) return;
    setPhotosUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('photos', f, f.name);
      const res = await fetch(`/api/listing-form/${propertyId}/photos`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) await fetchPhotos(propertyId);
      else alert(`Upload failed: ${data.error || 'unknown'}`);
    } catch (err) { alert(`Upload failed: ${err.message}`); }
    setPhotosUploading(false);
  };

  const deletePhoto = async (filename) => {
    const propertyId = activePropertyId || form.propertyId;
    if (!propertyId) return;
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await fetch(`/api/listing-form/${propertyId}/photos/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      fetchPhotos(propertyId);
    } catch {}
  };

  const runExtract = async () => {
    const propertyId = activePropertyId || form.propertyId;
    if (!propertyId) return;
    if (photos.length === 0) { alert('Upload some photos first.'); return; }
    setExtractLoading(true);
    setDismissedSuggestions({});
    try {
      const res = await fetch(`/api/listing-form/${propertyId}/photos/extract`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setExtractResult(data);
      else alert(`Extract failed: ${data.error || 'unknown'}`);
    } catch (err) { alert(`Extract failed: ${err.message}`); }
    setExtractLoading(false);
  };

  // Mapping from photo-vision field name -> deal-card form field
  const SUGGESTION_FIELD_MAP = {
    roofType:         { formField: 'roofType',         label: 'Roof Type' },
    roofAge:          { formField: 'roofAge',          label: 'Roof Condition' },
    exteriorMaterial: { formField: 'exteriorMaterial', label: 'Exterior Material' },
    foundationType:   { formField: 'foundationType',   label: 'Foundation Type' },
    flooringSummary:  { formField: null,               label: 'Flooring (summary)', informational: true },
    bathroomsDetected:{ formField: null,               label: 'Bathrooms detected', informational: true },
    kitchenSummary:   { formField: 'kitchenFeatures',  label: 'Kitchen', createField: true },
    acUnitOutsideSummary:{ formField: 'acUnitOutside', label: 'A/C (outside)', createField: true },
    heatSystem:       { formField: 'heatingType',      label: 'Heating System' },
    waterfront:       { formField: 'waterfront',       label: 'Waterfront' },
    notableFeatures:  { formField: 'notableFeatures',  label: 'Notable features', createField: true },
  };

  const acceptSuggestion = (suggestion) => {
    const map = SUGGESTION_FIELD_MAP[suggestion.field];
    if (!map) return;
    if (map.informational) {
      // Just dismiss informational suggestions; no form field to fill.
      setDismissedSuggestions(prev => ({ ...prev, [suggestion.field]: 'accepted' }));
      return;
    }
    if (!map.formField) return;
    updateField(map.formField, suggestion.value);
    setDismissedSuggestions(prev => ({ ...prev, [suggestion.field]: 'accepted' }));
  };

  // Map a photo-vision clustered room into the form.rooms[] shape.
  const roomFromCluster = (r) => ({
    name: r.label || 'Room',
    level: r.likelyLevel || 'Main',
    dimensions: '',
    flooring: r.flooring || '',
    features: Array.isArray(r.features) ? r.features.join(', ') : (r.features || ''),
    details: [],
    // Non-visible helpers stored alongside so we can trace back to photos:
    photoFilenames: r.photoFilenames || [],
    bathroomPieces: r.bathroomPieces || null,
    isEnsuite: r.isEnsuite || false,
  });

  const applyClusteredRooms = () => {
    const rooms = extractResult?.rooms || [];
    if (rooms.length === 0) return;
    const existing = form.rooms || [];
    if (existing.length > 0) {
      if (!confirm(`Overwrite ${existing.length} existing room entr${existing.length === 1 ? 'y' : 'ies'} with ${rooms.length} photo-detected room${rooms.length === 1 ? '' : 's'}?`)) return;
    }
    updateField('rooms', rooms.map(roomFromCluster));
    setDismissedSuggestions(prev => ({ ...prev, __rooms: 'accepted' }));
    // Expand the Room-by-Room section so Jonathan can see the result immediately.
    setExpanded(p => ({ ...p, rooms: true }));
  };

  const rejectSuggestion = async (suggestion) => {
    const propertyId = activePropertyId || form.propertyId;
    setDismissedSuggestions(prev => ({ ...prev, [suggestion.field]: 'rejected' }));
    if (!propertyId) return;
    try {
      await fetch(`/api/listing-form/${propertyId}/photos/suggestions/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: suggestion.field, suggestedValue: suggestion.value, evidence: suggestion.evidence,
        }),
      });
    } catch {}
  };

  useEffect(() => {
    fetchProperties();
    fetchFubAppointments();
    // Restore an in-progress draft if one exists and we have no saved deal loaded.
    try {
      const raw = localStorage.getItem('agenthq.listing-form.draft');
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && !draft.propertyId) {
          setForm(prev => ({ ...prev, ...draft }));
        }
      }
    } catch {}
  }, []);

  // Auto-collapse the Active Clients panel when a deal card is opened (so the
  // form below stays visible); auto-expand when Jonathan returns to a blank slate.
  useEffect(() => {
    if (activePropertyId) setAppointmentsExpanded(false);
    else setAppointmentsExpanded(true);
  }, [activePropertyId]);

  // When the active deal changes, pull its attached photos (and any cached
  // extract result). When we unload / hit New Listing, clear.
  useEffect(() => {
    fetchPhotos(activePropertyId);
    setDismissedSuggestions({});
  }, [activePropertyId]);

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

  // Reset — wipes the in-progress form + local draft so Jonathan can start
  // blank. Does NOT touch saved listings on the server; use the trash icon
  // for that.
  const resetForm = () => {
    if (!confirm('Reset the form? Any unsaved edits on this deal card will be cleared. Saved listings on the server are not affected.')) return;
    try { localStorage.removeItem('agenthq.listing-form.draft'); } catch {}
    createNew();
  };

  // Close — archive the listing, scrub the property address from the FUB
  // contact, and flip their stage to Past Client.
  const closeListing = async () => {
    if (!activePropertyId) return;
    const confirmed = confirm(
      `Mark "${form.address || activePropertyId}" as closed?\n\n` +
      `• Deal card will be archived (kept as read-only).\n` +
      `• The property address will be removed from the FUB contact.\n` +
      `• The contact will move to the Past Client stage.\n\n` +
      `You can continue working with this client, but this property will no longer be active.`
    );
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/listing-form/${activePropertyId}/close`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) { alert(`Could not close listing: ${data.error || 'unknown error'}`); return; }
      await fetchProperties();
      createNew();
    } catch (err) {
      alert(`Could not close listing: ${err.message}`);
    }
  };

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
          <button onClick={resetForm} title="Reset the form — clears unsaved edits" style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
            background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}><RotateCcw size={13} /> Reset</button>
          {activePropertyId && (
            <button
              onClick={async () => {
                // Save first so the print view reflects the latest edits.
                await saveForm();
                const url = `/api/listing-form/${activePropertyId}/print`;
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
              title="Open a printable listing sheet in a new tab — the print dialog launches automatically; pick Save as PDF"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
                background: '#fff', color: '#2563eb', border: '1px solid #2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            ><FileText size={13} /> Print / PDF</button>
          )}
          {activePropertyId && (
            <button onClick={closeListing} title="Close the listing: archive the deal card, scrub the address from FUB, move the contact to Past Client" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
              background: '#fff', color: '#059669', border: '1px solid #10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}><CheckCircle2 size={13} /> House is Closed</button>
          )}
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
              {p.address || p.propertyId}{p.city ? `, ${p.city}` : ''}{p.listPrice ? ` — $${Number(p.listPrice).toLocaleString()}` : ''}{p.status === 'active' ? ' ✓' : ''}{p.sellerSubmittedAt ? ' · seller ✓' : ''}
            </option>
          ))}
        </select>
        <button onClick={() => setQuickAdd(q => ({ ...q, open: true, error: null }))} title="Quick add a property to the pick list" style={{
          width: 34, height: 34, borderRadius: 8, border: '1px solid #d1d5db', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}><Plus size={16} color="#6b7280" /></button>
        {activePropertyId && <button onClick={() => deleteProperty(activePropertyId)} title="Delete listing" style={{
          width: 34, height: 34, borderRadius: 8, border: '1px solid #fca5a5', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}><Trash size={14} color="#ef4444" /></button>}
      </div>

      {/* Quick-add property popover — shows under the selector bar.
          Just address + city, drops the property into the pick list and opens its card. */}
      {quickAdd.open && (
        <div style={{
          background: '#fff', borderRadius: 10, border: '1px solid #c8a96e',
          padding: 14, marginBottom: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Plus size={14} color="#c8a96e" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92730a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quick add to pick list
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setQuickAdd({ open: false, address: '', city: 'Midland', busy: false, error: null })}
              style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4 }}
              title="Cancel"
            ><X size={14} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Address *</label>
              <input
                autoFocus
                style={inputStyle}
                value={quickAdd.address}
                onChange={e => setQuickAdd(q => ({ ...q, address: e.target.value, error: null }))}
                onKeyDown={e => { if (e.key === 'Enter' && !quickAdd.busy) quickAddProperty(); }}
                placeholder="375 Champlain Road"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>City</label>
              <input
                style={inputStyle}
                value={quickAdd.city}
                onChange={e => setQuickAdd(q => ({ ...q, city: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !quickAdd.busy) quickAddProperty(); }}
                placeholder="Midland"
              />
            </div>
            <button
              onClick={quickAddProperty}
              disabled={quickAdd.busy || !quickAdd.address.trim()}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: quickAdd.busy || !quickAdd.address.trim() ? '#e5e7eb' : '#c8a96e',
                color: '#fff', cursor: quickAdd.busy || !quickAdd.address.trim() ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700, height: 36, whiteSpace: 'nowrap',
              }}
            >
              {quickAdd.busy ? 'Adding...' : 'Add'}
            </button>
          </div>
          {quickAdd.error && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>{quickAdd.error}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
            Lands in the dropdown immediately. Card opens so you can keep filling in details — or come back later.
            <button
              onClick={() => { setQuickAdd({ open: false, address: '', city: 'Midland', busy: false, error: null }); createNew(); }}
              style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: 0, marginLeft: 6, textDecoration: 'underline' }}
            >Just open a blank form</button>
          </div>
        </div>
      )}

      {/* ACTIVE CLIENTS FROM FUB — collapses to a thin bar when a deal card is
          open so the form below stays visible. Click the header to expand/collapse. */}
      {fubAppointments.filter(a => !a.hasListingForm).length > 0 && (
        <div style={{
          background: '#fffbf0', borderRadius: 10, border: '1px solid #f0dca0',
          padding: appointmentsExpanded ? '14px 16px' : '8px 14px',
          marginBottom: 12, transition: 'padding 0.15s',
        }}>
          <div
            onClick={() => setAppointmentsExpanded(e => !e)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAppointmentsExpanded(v => !v); } }}
            title={appointmentsExpanded ? 'Collapse' : 'Expand to see active clients'}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              marginBottom: appointmentsExpanded ? 10 : 0,
              userSelect: 'none',
            }}
          >
            {appointmentsExpanded ? <ChevronDown size={14} color="#92730a" /> : <ChevronRight size={14} color="#92730a" />}
            <Users size={14} color="#92730a" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92730a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Active Clients from Follow Up Boss
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: '#c8a96e', padding: '2px 8px', borderRadius: 10 }}>
              {fubAppointments.filter(a => !a.hasListingForm).length} new
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={(e) => { e.stopPropagation(); fetchFubAppointments(); }}
              disabled={loadingFub}
              style={{
                fontSize: 10, color: '#92730a', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
            >{loadingFub ? 'Syncing...' : 'Refresh'}</button>
          </div>
          {appointmentsExpanded && (<>
          <div style={{ fontSize: 10, color: '#92730a', marginTop: -4, marginBottom: 8, fontStyle: 'italic' }}>
            Click a client to open their deal card.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fubAppointments.filter(a => !a.hasListingForm).map(appt => {
              const isImporting = importingFub === appt.fubId;
              const handleOpenDealCard = () => {
                if (isImporting) return;
                importFubAppointment(appt);
              };
              return (
                <div
                  key={appt.fubId}
                  onClick={handleOpenDealCard}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenDealCard(); } }}
                  title="Open deal card"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb',
                    cursor: isImporting ? 'wait' : 'pointer',
                    opacity: isImporting ? 0.7 : 1,
                    transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (isImporting) return;
                    e.currentTarget.style.background = '#fffbf0';
                    e.currentTarget.style.borderColor = '#c8a96e';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{appt.name || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {appt.address ? `${appt.address}${appt.city ? `, ${appt.city}` : ''}` : 'No address in FUB'}
                      {appt.phone ? ` · ${appt.phone}` : ''}
                      {appt.email ? ` · ${appt.email}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenDealCard(); }}
                    disabled={isImporting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
                      border: '1px solid #c8a96e', background: '#c8a96e', color: '#fff',
                      fontSize: 11, fontWeight: 600, cursor: isImporting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {isImporting ? (
                      <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Opening...</>
                    ) : (
                      <><Plus size={12} /> Open Deal Card</>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          </>)}
        </div>
      )}

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

        {/* Seller-submitted pill — shows green when the seller has filled
            their half of the form via the public link. Click → reload the
            current listing so any new fields the seller wrote come down. */}
        {form.sellerSubmittedAt && (
          <button
            onClick={() => activePropertyId && loadProperty(activePropertyId)}
            title="Click to reload — pulls down the latest fields the seller submitted"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8,
              border: '1px solid #059669', background: '#ecfdf5', color: '#065f46',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          ><CheckCircle2 size={12} /> Seller submitted {new Date(form.sellerSubmittedAt).toLocaleDateString()}</button>
        )}
      </div>

      {/* DEPLOY TARGETS — where this listing's data is pushed. Today: Sisu.
          Tomorrow (once the REALM destination is wired) this row grows to
          hold a REALM URL too. The /sisu-export endpoint already returns
          whatever is pasted here as `sisuUrl` so the Chrome extension can
          navigate before populating fields. */}
      <div style={{
        background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
        padding: '12px 16px', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>
          Deploy → Sisu:
        </span>
        <input
          type="url"
          value={form.sisuTransactionUrl || ''}
          onChange={e => updateField('sisuTransactionUrl', e.target.value)}
          placeholder="Paste Sisu transaction URL (e.g. https://app.sisu.co/app/transactions/6361210/edit/draft-100a-…)"
          style={{ flex: 1, minWidth: 240, fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
        />
        {form.sisuTransactionUrl && (
          <a
            href={form.sisuTransactionUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8,
              border: '1px solid #7c3aed', background: '#f5f3ff', color: '#6d28d9',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          ><ArrowUpRight size={13} /> Open in Sisu</a>
        )}
        {activePropertyId && (
          <button
            onClick={async () => {
              if (!form.sisuTransactionUrl) {
                alert('Paste the Sisu transaction URL in this bar first, then Push to Sisu.');
                return;
              }
              try {
                // 1) Save first so the export reflects the latest edits.
                await saveForm();
                // 2) Fetch the export JSON.
                const r = await fetch(`/api/listing-form/${activePropertyId}/sisu-export`);
                const data = await r.json();
                if (!data.success) { alert(`Export failed: ${data.error || 'unknown'}`); return; }
                data.exportedAt = new Date().toISOString();
                setSisuExport(data);
                // 3) Stash the export in clipboard for the autofill skill to read.
                try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); } catch {}
                // 4) Open the Sisu transaction URL in a new tab.
                window.open(form.sisuTransactionUrl, '_blank', 'noopener,noreferrer');
                // 5) Tell Jonathan what to do next.
                alert(
                  `Sisu opened in a new tab with ${data.fieldCount} field(s) mapped${data.roomCount ? ` and ${data.roomCount} room(s)` : ''}.\n\n` +
                  `The export JSON is on your clipboard.\n\n` +
                  `Next: switch to the Cowork chat and say "autofill Sisu" — Claude will read the clipboard and fill the form on the open tab.`
                );
              } catch (err) { alert(`Push failed: ${err.message}`); }
            }}
            title="Save, export, open Sisu, copy the field JSON to clipboard — then ask Claude to autofill"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 8,
              border: '1px solid #2563eb', background: '#2563eb', color: '#fff',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          ><ArrowUpRight size={13} /> Push to Sisu</button>
        )}
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

          {/* SECTION 2B: PHOTOS — drop photos, auto-extract into the data sheet */}
          <FormSection title="Photos" icon={FileText} expanded={expanded.photos !== false} onToggle={() => toggle('photos')} badge={photos.length || null}>
            {!activePropertyId && (
              <div style={{ fontSize: 12, color: '#6b7280', padding: '12px 2px' }}>
                Save the deal card first (fill in the address) to attach photos.
              </div>
            )}
            {activePropertyId && (
              <>
                {/* Dropzone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setPhotosDragOver(true); }}
                  onDragLeave={() => setPhotosDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setPhotosDragOver(false);
                    if (e.dataTransfer?.files) uploadPhotos(e.dataTransfer.files);
                  }}
                  onClick={() => photoFileRef.current?.click()}
                  style={{
                    border: `2px dashed ${photosDragOver ? '#c8a96e' : '#d1d5db'}`,
                    background: photosDragOver ? '#fffbf0' : '#fafafa',
                    borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
                    marginBottom: 12, transition: 'background 0.12s, border-color 0.12s',
                  }}
                >
                  <input
                    ref={photoFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => { uploadPhotos(e.target.files); e.target.value = ''; }}
                  />
                  <div style={{ fontSize: 13, color: '#4b5563', fontWeight: 600, marginBottom: 4 }}>
                    {photosUploading ? 'Uploading…' : 'Drop photos here, or click to browse'}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    JPG / PNG / HEIC up to 25MB each · one folder per listing
                  </div>
                </div>

                {/* Photo grid */}
                {photosLoading ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, padding: 12 }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading photos…
                  </div>
                ) : photos.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: 4 }}>
                    No photos attached yet.
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                    gap: 8, marginBottom: 12,
                  }}>
                    {photos.map(p => (
                      <div key={p.filename} style={{
                        position: 'relative', borderRadius: 8, overflow: 'hidden',
                        border: '1px solid #e5e7eb', background: '#f3f4f6',
                        aspectRatio: '1 / 1',
                      }}>
                        <img
                          src={`/api/listing-form/${activePropertyId}/photos/${encodeURIComponent(p.filename)}`}
                          alt={p.filename}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <button
                          onClick={() => deletePhoto(p.filename)}
                          title="Delete photo"
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                            borderRadius: 11, border: 'none', background: 'rgba(17,24,39,0.65)',
                            color: '#fff', cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        ><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Extract button + summary */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={runExtract}
                    disabled={extractLoading || photos.length === 0}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
                      border: '1px solid #c8a96e', background: photos.length === 0 ? '#f3f4f6' : '#c8a96e',
                      color: photos.length === 0 ? '#9ca3af' : '#fff',
                      fontSize: 12, fontWeight: 600, cursor: photos.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {extractLoading ? (
                      <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing {photos.length} photo{photos.length === 1 ? '' : 's'}…</>
                    ) : (
                      <><Play size={13} /> Extract from photos</>
                    )}
                  </button>
                  {extractResult && (
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      {extractResult.analyzed}/{extractResult.photoCount} analyzed
                      {extractResult.extractedAt && ` · ${new Date(extractResult.extractedAt).toLocaleTimeString()}`}
                    </span>
                  )}
                </div>

                {/* Rooms detected — offer to populate the Room-by-Room section */}
                {extractResult && Array.isArray(extractResult.rooms) && extractResult.rooms.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: '1px dashed #e5e7eb', paddingTop: 12 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '12px 14px', borderRadius: 8,
                      border: '1px solid ' + (dismissedSuggestions.__rooms === 'accepted' ? '#10b981' : '#c8a96e'),
                      background: dismissedSuggestions.__rooms === 'accepted' ? '#ecfdf5' : '#fffbf0',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                          Room-by-Room · {extractResult.rooms.length} unique room{extractResult.rooms.length === 1 ? '' : 's'} detected
                        </div>
                        <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3, lineHeight: 1.5 }}>
                          {extractResult.rooms.map((r, i) => {
                            const piece = r.bathroomPieces ? ` (${r.bathroomPieces}-pc)` : '';
                            const ens = r.isEnsuite ? ' · ensuite' : '';
                            const lvl = r.likelyLevel ? ` · ${r.likelyLevel}` : '';
                            const photoN = (r.photoFilenames || []).length;
                            return (
                              <span key={i} style={{ display: 'inline-block', marginRight: 10 }}>
                                <strong>{r.label}</strong>{piece}{ens}{lvl}
                                <span style={{ color: '#9ca3af' }}> · {photoN} photo{photoN === 1 ? '' : 's'}</span>
                              </span>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 10, color: '#92730a', marginTop: 4, fontStyle: 'italic' }}>
                          Same-room detection uses linens / artwork for bedrooms, fixture layout for baths.
                        </div>
                      </div>
                      {dismissedSuggestions.__rooms === 'accepted' ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={13} /> Rooms filled
                        </span>
                      ) : (
                        <button
                          onClick={applyClusteredRooms}
                          style={{
                            padding: '8px 14px', borderRadius: 7, border: '1px solid #c8a96e',
                            background: '#c8a96e', color: '#fff', fontSize: 11, fontWeight: 600,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >Fill Room-by-Room</button>
                      )}
                    </div>
                  </div>
                )}

                {/* Suggestions */}
                {extractResult && extractResult.suggestions && extractResult.suggestions.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: '1px dashed #e5e7eb', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Suggestions — only fields still empty will be filled
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {extractResult.suggestions.map(s => {
                        const map = SUGGESTION_FIELD_MAP[s.field] || { label: s.field };
                        const status = dismissedSuggestions[s.field]; // 'accepted' | 'rejected' | undefined
                        const currentFormValue = map.formField ? (form[map.formField] || '') : '';
                        const fieldAlreadyFilled = !!currentFormValue && !map.informational;
                        const confidenceColor = s.confidence === 'high' ? '#059669' : s.confidence === 'medium' ? '#d97706' : '#9ca3af';
                        return (
                          <div key={s.field} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 8,
                            border: '1px solid ' + (status === 'accepted' ? '#10b981' : status === 'rejected' ? '#e5e7eb' : '#e5e7eb'),
                            background: status === 'accepted' ? '#ecfdf5' : '#fff',
                            opacity: status === 'rejected' ? 0.55 : 1,
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                                {map.label}
                                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: confidenceColor, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                                  {s.confidence}
                                </span>
                                {s.evidence && s.evidence.length > 0 && (
                                  <span style={{ marginLeft: 8, fontSize: 10, color: '#9ca3af' }}>
                                    · {s.evidence.length} photo{s.evidence.length === 1 ? '' : 's'}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#374151', marginTop: 2, wordBreak: 'break-word' }}>
                                {s.value}
                              </div>
                              {fieldAlreadyFilled && (
                                <div style={{ fontSize: 10, color: '#d97706', marginTop: 2, fontStyle: 'italic' }}>
                                  Field already has "{currentFormValue}" — accept will overwrite.
                                </div>
                              )}
                              {map.informational && (
                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, fontStyle: 'italic' }}>
                                  Informational — use to update Bedrooms / Bathrooms / Rooms manually.
                                </div>
                              )}
                            </div>
                            {!status && (
                              <>
                                <button
                                  onClick={() => acceptSuggestion(s)}
                                  disabled={map.informational === true && !map.formField}
                                  title={map.informational ? 'Acknowledge and dismiss' : 'Fill the field with this value'}
                                  style={{
                                    padding: '6px 12px', borderRadius: 6, border: '1px solid #10b981',
                                    background: '#10b981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                  }}
                                >{map.informational ? 'OK' : 'Accept'}</button>
                                <button
                                  onClick={() => rejectSuggestion(s)}
                                  title="Mark wrong — helps the next run learn"
                                  style={{
                                    padding: '6px 12px', borderRadius: 6, border: '1px solid #fca5a5',
                                    background: '#fff', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                  }}
                                >Reject</button>
                              </>
                            )}
                            {status === 'accepted' && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle2 size={13} /> Accepted
                              </span>
                            )}
                            {status === 'rejected' && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Rejected</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {extractResult.descriptive && extractResult.descriptive.length > 0 && (
                      <div style={{ marginTop: 12, padding: 10, background: '#fffbf0', borderRadius: 8, border: '1px dashed #f0dca0' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#92730a', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                          Descriptive snippets — saved for MLS description generator (Stage 2)
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                          {extractResult.descriptive.slice(0, 8).map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
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
              <FormField label="Style">{sel('style', STYLE_OPTIONS, 'Select...')}</FormField>
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
              <FormField label="Panel Amps">{sel('electricalAmps', ELECTRICAL_AMP_OPTIONS, 'Select...')}</FormField>
              <FormField label="Breakers or Fuses">{sel('electricalType', ELECTRICAL_TYPE_OPTIONS, 'Select...')}</FormField>
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
              {form.furnaceOwnedRented === 'Rented' && (
                <FormField label="Furnace Monthly Cost ($)">{inp('furnaceMonthlyCost', 'e.g. 65')}</FormField>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <FormField label="Air Conditioning">
                <ChipSelect options={AC_OPTIONS} selected={form.acTypes || []} onChange={v => updateField('acTypes', v)} />
              </FormField>
            </div>
            <div style={{ ...gridStyle(3), marginTop: 14 }}>
              <FormField label="AC Owned / Rented">{sel('acOwnedRented', ['Owned', 'Rented', 'N/A'], 'Select...')}</FormField>
              {form.acOwnedRented === 'Rented' && (
                <FormField label="AC Monthly Cost ($)">{inp('acMonthlyCost', 'e.g. 45')}</FormField>
              )}
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
              {form.hotWaterOwnedRented === 'Rented' && (
                <FormField label="HWT Monthly Cost ($)">{inp('hotWaterMonthlyCost', 'e.g. 35')}</FormField>
              )}
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
              <FormField label="Septic Details" span={2}>{inp('septicDetails', 'Age, size, anything notable')}</FormField>
              <FormField label="Septic Last Pumped">{inp('septicLastPumped', 'e.g. May 2024')}</FormField>
              <FormField label="Septic Last Inspected">{inp('septicLastInspected', 'e.g. Apr 2023')}</FormField>
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
            {(!form.rooms || form.rooms.length === 0) && (
              <button type="button" onClick={generateStandardRooms} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8,
                border: '1.5px solid #c8a96e', background: '#fdf8f0', fontSize: 12, fontWeight: 600,
                color: '#c8a96e', cursor: 'pointer', width: '100%', justifyContent: 'center', marginBottom: 10,
              }}><Sparkles size={14} /> Generate Standard Rooms ({form.bedrooms || 3} Bed / {form.bathrooms || 1} Bath)</button>
            )}
            {(form.rooms || []).map((room, idx) => (
              <div key={idx} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280' }}>ROOM {idx + 1}{room.name ? ` — ${room.name}` : ''}</span>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => removeRoom(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                    <X size={14} color="#ef4444" />
                  </button>
                </div>
                <div style={gridStyle(3)}>
                  <FormField label="Room Name">
                    <input style={inputStyle} value={room.name} onChange={e => updateRoom(idx, 'name', e.target.value)} placeholder="e.g. Primary Bedroom" />
                  </FormField>
                  <FormField label="Level">
                    <select style={selectStyle} value={room.level} onChange={e => updateRoom(idx, 'level', e.target.value)}>
                      {['Main', 'Upper', 'Lower', 'Basement'].map(l => <option key={l}>{l}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Flooring">
                    <select style={selectStyle} value={room.flooring || ''} onChange={e => updateRoom(idx, 'flooring', e.target.value)}>
                      <option value="">Select...</option>
                      {FLOORING_TYPES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </FormField>
                </div>
                <div style={{ marginTop: 8 }}>
                  <FormField label="Room Details">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {getRoomDetailOptions(room.name).map(opt => {
                        const active = (room.details || []).includes(opt);
                        return (
                          <button key={opt} type="button" onClick={() => toggleRoomDetail(idx, opt)} style={{
                            padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: active ? 600 : 400,
                            border: `1.5px solid ${active ? '#c8a96e' : '#d1d5db'}`,
                            background: active ? '#c8a96e' : '#fff', color: active ? '#fff' : '#374151',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}>{opt}</button>
                        );
                      })}
                    </div>
                  </FormField>
                </div>
                <div style={{ marginTop: 8 }}>
                  <FormField label="Additional Notes">
                    <input style={inputStyle} value={room.features} onChange={e => updateRoom(idx, 'features', e.target.value)} placeholder="Ensuite, bay window, built-in shelving..." />
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

          {/* SECTION: SISU EXPORT — duplicated URL input removed; use the
              Deploy → Sisu bar at the top of this form. Keep only the
              last-export status summary here so Jonathan can see field
              counts after pushing. */}
          <FormSection title="Export to Sisu" icon={ExternalLink} expanded={expanded.sisu} onToggle={() => toggle('sisu')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: '#4b5563', margin: 0 }}>
                Paste the Sisu transaction URL in the <strong>Deploy → Sisu</strong> bar at the top of this deal card, then click <strong>Push to Sisu</strong>. Sisu opens in a new tab and the field data copies to your clipboard — ready for the autofill skill.
              </p>
              {sisuExport && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 4 }}>Last Export</div>
                  <div style={{ fontSize: 11, color: '#15803d' }}>
                    {sisuExport.fieldCount} fields mapped · {sisuExport.roomCount || 0} rooms · exported {sisuExport.exportedAt ? new Date(sisuExport.exportedAt).toLocaleTimeString() : 'just now'}.
                  </div>
                </div>
              )}
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

export default ListingForm;
