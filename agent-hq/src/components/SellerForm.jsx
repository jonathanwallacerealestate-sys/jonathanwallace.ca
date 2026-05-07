// src/components/SellerForm.jsx
//
// PUBLIC seller-facing form — what the seller sees when they click the link
// Jonathan emails them. No auth, no sidebar, no admin chrome. Renders only
// the fields in SELLER_FORM_SECTIONS, which match the SELLER_FIELDS whitelist
// the backend enforces.
//
// Mounted by App.jsx when the URL has ?seller=PROPERTY_ID.
//
// Created 2026-05-07.

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Send, AlertCircle } from 'lucide-react';
import {
  AC_OPTIONS, APPLIANCE_OPTIONS, ELECTRICAL_AMP_OPTIONS, ELECTRICAL_TYPE_OPTIONS,
  HEATING_OPTIONS, INCLUSION_OPTIONS, SELLER_FORM_SECTIONS,
} from '../config/listing-form-options.js';
import { ChipSelect } from './form-helpers.jsx';

// Field metadata — controls what input renders for each whitelisted field.
// type: 'text' | 'textarea' | 'select' | 'chips'. options: only for select/chips.
const FIELD_META = {
  taxes:                { label: 'Annual property taxes ($)', type: 'text', placeholder: 'e.g. 3,200' },
  sellerName:           { label: 'Your full name', type: 'text', placeholder: 'John Smith' },
  sellerPhone:          { label: 'Your cell number', type: 'text', placeholder: '705-555-0123' },
  sellerEmail:          { label: 'Your email', type: 'text', placeholder: 'john@email.com' },
  sellerName2:          { label: 'Second seller — full name (optional)', type: 'text', placeholder: '' },
  sellerPhone2:         { label: 'Second seller — cell (optional)', type: 'text', placeholder: '' },
  sellerEmail2:         { label: 'Second seller — email (optional)', type: 'text', placeholder: '' },
  electricalAmps:       { label: 'Panel amps', type: 'select', options: ELECTRICAL_AMP_OPTIONS },
  electricalType:       { label: 'Breakers or fuses', type: 'select', options: ELECTRICAL_TYPE_OPTIONS },
  roofAge:              { label: 'Age of roof (years)', type: 'text', placeholder: 'e.g. 8' },
  septicLastPumped:     { label: 'Last time septic was pumped', type: 'text', placeholder: 'e.g. May 2024' },
  septicLastInspected:  { label: 'Last time septic was inspected', type: 'text', placeholder: 'e.g. Apr 2023' },
  septicDetails:        { label: 'Anything else about the septic', type: 'textarea', placeholder: 'Age, size, anything notable' },
  furnaceAge:           { label: 'Furnace age (years)', type: 'text', placeholder: 'e.g. 6' },
  furnaceOwnedRented:   { label: 'Furnace owned or rented', type: 'select', options: ['Owned', 'Rented'] },
  furnaceMonthlyCost:   { label: 'If rented — monthly cost ($)', type: 'text', placeholder: 'e.g. 65', conditional: { field: 'furnaceOwnedRented', equals: 'Rented' } },
  acOwnedRented:        { label: 'AC owned or rented (skip if no AC)', type: 'select', options: ['Owned', 'Rented', 'N/A'] },
  acMonthlyCost:        { label: 'If rented — monthly cost ($)', type: 'text', placeholder: 'e.g. 45', conditional: { field: 'acOwnedRented', equals: 'Rented' } },
  hotWaterType:         { label: 'Hot water tank type', type: 'select', options: ['Tank — Gas', 'Tank — Electric', 'Tank — Propane', 'Tankless — Gas', 'Tankless — Electric', 'On-Demand'] },
  hotWaterAge:          { label: 'HWT age (years)', type: 'text', placeholder: 'e.g. 9' },
  hotWaterOwnedRented:  { label: 'HWT owned or rented', type: 'select', options: ['Owned', 'Rented'] },
  hotWaterMonthlyCost:  { label: 'If rented — monthly cost ($)', type: 'text', placeholder: 'e.g. 35', conditional: { field: 'hotWaterOwnedRented', equals: 'Rented' } },
  rentalItems:          { label: 'Other rental items', type: 'text', placeholder: 'e.g. water softener, propane tank' },
  hydroProvider:        { label: 'Hydro provider', type: 'text', placeholder: 'e.g. Midland Power' },
  propaneProvider:      { label: 'Propane provider (if applicable)', type: 'text', placeholder: '' },
  gasProvider:          { label: 'Natural gas provider (if applicable)', type: 'text', placeholder: 'e.g. Enbridge' },
  internetProvider:     { label: 'Internet provider', type: 'text', placeholder: 'e.g. Bell, Rogers' },
  internetType:         { label: 'Internet type', type: 'select', options: ['Fibre', 'Cable', 'DSL', 'Fixed Wireless', 'Satellite', 'Starlink'] },
  appliancesIncluded:   { label: 'Appliances included with the sale', type: 'chips', options: APPLIANCE_OPTIONS },
  otherInclusions:      { label: 'Other items included', type: 'chips', options: INCLUSION_OPTIONS },
  inclusionsNotes:      { label: 'Anything else included', type: 'textarea', placeholder: 'List any other items staying with the home' },
  exclusions:           { label: 'Items NOT included (you’re taking them)', type: 'textarea', placeholder: 'Chandelier, mirror, beer fridge, etc.' },
  visibleUpgrades:      { label: 'Visible upgrades (kitchen, baths, flooring, windows)', type: 'textarea', placeholder: 'List upgrades a buyer would notice and roughly when' },
  hiddenUpgrades:       { label: 'Hidden upgrades (plumbing, electrical, insulation, foundation)', type: 'textarea', placeholder: 'Anything done behind the walls and roughly when' },
  floorPlanChanges:     { label: 'Layout changes', type: 'textarea', placeholder: 'Walls removed, rooms added, layout changes?' },
};

const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};
const textareaStyle = { ...inputStyle, minHeight: 70, resize: 'vertical' };

export default function SellerForm({ propertyId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [header, setHeader] = useState(null);
  const [agent, setAgent] = useState(null);
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null); // null | { sellerSubmittedAt, fieldsWritten }
  const [alreadySubmittedAt, setAlreadySubmittedAt] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/seller-form/${encodeURIComponent(propertyId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) {
          setError(data.error || 'Could not load this listing.');
        } else {
          setHeader(data.header);
          setAgent(data.agent);
          setValues(data.values || {});
          setAlreadySubmittedAt(data.sellerSubmittedAt || '');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  const updateField = (field, value) => setValues(v => ({ ...v, [field]: value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/seller-form/${encodeURIComponent(propertyId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted({ sellerSubmittedAt: data.sellerSubmittedAt, fieldsWritten: data.fieldsWritten });
      } else {
        setError(data.error || 'Submission failed.');
      }
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  const renderField = (fieldName) => {
    const meta = FIELD_META[fieldName];
    if (!meta) return null;

    // Conditional fields (only show when another field has a specific value)
    if (meta.conditional) {
      const dep = values[meta.conditional.field];
      if (dep !== meta.conditional.equals) return null;
    }

    const value = values[fieldName];

    let control;
    if (meta.type === 'text') {
      control = (
        <input
          type="text"
          value={value || ''}
          onChange={e => updateField(fieldName, e.target.value)}
          placeholder={meta.placeholder || ''}
          style={inputStyle}
        />
      );
    } else if (meta.type === 'textarea') {
      control = (
        <textarea
          value={value || ''}
          onChange={e => updateField(fieldName, e.target.value)}
          placeholder={meta.placeholder || ''}
          style={textareaStyle}
        />
      );
    } else if (meta.type === 'select') {
      control = (
        <select
          value={value || ''}
          onChange={e => updateField(fieldName, e.target.value)}
          style={inputStyle}
        >
          <option value="">Select...</option>
          {meta.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (meta.type === 'chips') {
      control = (
        <ChipSelect
          options={meta.options}
          selected={Array.isArray(value) ? value : []}
          onChange={v => updateField(fieldName, v)}
        />
      );
    }

    return (
      <div key={fieldName} style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          {meta.label}
        </label>
        {control}
      </div>
    );
  };

  // ───── Render states ─────

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 60 }}>
          <Loader2 size={28} color="#c8a96e" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <div style={{ color: '#6b7280', fontSize: 14 }}>Loading your listing details…</div>
        </div>
      </div>
    );
  }

  if (error && !header) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 50 }}>
          <AlertCircle size={36} color="#dc2626" style={{ margin: '0 auto 14px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
            We couldn’t open this form
          </div>
          <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>{error}</div>
          <div style={{ color: '#9ca3af', fontSize: 12 }}>
            Please reply to Jonathan’s email so he can resend the link.
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 60 }}>
          <CheckCircle2 size={48} color="#059669" style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
            Thank you — got it!
          </div>
          <div style={{ color: '#374151', fontSize: 14, marginBottom: 6 }}>
            Your details for {header.address}{header.city ? `, ${header.city}` : ''} have been sent to Jonathan.
          </div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            He’ll review and follow up. If anything changes, just reply to his original email.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 18, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#c8a96e', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
            Pre-Listing Questionnaire
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
            {header.address}
          </div>
          {header.city && (
            <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
              {header.city}{header.postalCode ? `, ${header.postalCode}` : ''}
            </div>
          )}
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#fffbeb', borderLeft: '3px solid #c8a96e', borderRadius: 4, fontSize: 13, color: '#78350f' }}>
            Hi from {agent?.name || 'Jonathan'} — these are the details that only you would know about your home.
            Takes about 10 minutes. Skip any field that doesn’t apply (e.g. septic if you’re on municipal sewer).
            {alreadySubmittedAt && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#92400e' }}>
                You submitted this on {new Date(alreadySubmittedAt).toLocaleDateString()} — feel free to update any answers.
              </div>
            )}
          </div>
        </div>

        {/* Form sections */}
        <form onSubmit={onSubmit}>
          {SELLER_FORM_SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
                {section.title}
              </div>
              {section.description && (
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                  {section.description}
                </div>
              )}
              {section.fields.map(renderField)}
            </div>
          ))}

          {error && (
            <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: '14px 20px', borderRadius: 8,
              background: submitting ? '#9ca3af' : '#c8a96e', color: '#fff',
              border: 'none', fontSize: 15, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
            {submitting ? 'Sending…' : 'Send my answers to Jonathan'}
          </button>
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
            {agent?.name} · {agent?.team} · {agent?.phone}
          </div>
        </form>
      </div>
    </div>
  );
}

// ───── Inline styles (page chrome — no Tailwind in this codebase) ─────

const pageStyle = {
  minHeight: '100vh',
  background: '#f9fafb',
  padding: '24px 16px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const cardStyle = {
  maxWidth: 640,
  margin: '0 auto',
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  padding: '28px 32px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};
