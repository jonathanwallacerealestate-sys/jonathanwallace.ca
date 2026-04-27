// src/components/form-styles.js
//
// Shared inline-style constants used by the Listing Form, modals, and any
// other form-shaped UI in Agent HQ. Pure data — no React, no side effects.

export const inputStyle    = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, color: '#111827', background: '#fafafa', outline: 'none', boxSizing: 'border-box' };
export const selectStyle   = { ...inputStyle, appearance: 'auto' };
export const textareaStyle = { ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' };
export const gridStyle     = (cols = 3) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '12px 16px' });
