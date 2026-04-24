// lib/photo-vision/index.js
//
// Vision extraction over listing photos. See README.md for the flow.

import { buildPrompt, PROMPT_VERSION } from './prompt.js';

// Map common extensions -> Anthropic-supported media types.
function mediaTypeFor(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png':  return 'image/png';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default:     return 'image/jpeg';
  }
}

// Pull the JSON object out of Claude's text response. Tolerates prose
// wrappers or ```json fences even though the prompt says not to.
function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fence ? fence[1] : text).trim();
  try { return JSON.parse(candidate); } catch {}
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch {}
  }
  return null;
}

export async function analyzePhoto(buffer, ctx = {}) {
  const { anthropic, model = 'claude-haiku-4-5-20251001', filename = 'photo.jpg', address, city, logger = console } = ctx;
  if (!anthropic) return { ok: false, error: 'anthropic client not provided' };
  if (!buffer || !buffer.length) return { ok: false, error: 'empty buffer' };

  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaTypeFor(filename),
              data: buffer.toString('base64'),
            },
          },
          { type: 'text', text: buildPrompt({ address, city }) },
        ],
      }],
    });

    const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed) {
      logger.warn(`[photo-vision] JSON parse failed for ${filename}; raw: ${text.slice(0, 200)}`);
      return { ok: false, error: 'json parse failed', raw: text };
    }
    return { ok: true, filename, ...parsed };
  } catch (err) {
    logger.warn(`[photo-vision] analyzePhoto error for ${filename}: ${err.message}`);
    return { ok: false, filename, error: err.message };
  }
}

// ─── Aggregation ───

function voteOn(values) {
  // values: [{ value, filename, confidence }]
  // Returns [{ value, count, evidence: [filenames], confidence }]
  const groups = new Map();
  for (const v of values) {
    if (!v || v.value == null || v.value === '') continue;
    const key = String(v.value).toLowerCase().trim();
    const g = groups.get(key) || { value: v.value, count: 0, evidence: [], confidence: v.confidence || 'medium' };
    g.count += 1;
    if (v.filename) g.evidence.push(v.filename);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const FIELD_DEFS = [
  { key: 'roofType',         source: (p) => p.fields?.roofType,         photoClasses: ['exterior_front', 'exterior_back', 'exterior_side', 'exterior_detail', 'aerial'] },
  { key: 'roofAge',          source: (p) => p.fields?.roofCondition,    photoClasses: ['exterior_front', 'exterior_back', 'exterior_side', 'exterior_detail', 'aerial'] },
  { key: 'exteriorMaterial', source: (p) => p.fields?.exteriorMaterial, photoClasses: ['exterior_front', 'exterior_back', 'exterior_side', 'exterior_detail'] },
  { key: 'foundationType',   source: (p) => p.fields?.foundationType,   photoClasses: ['exterior_detail', 'basement', 'mechanical'] },
];

function aggregateField(def, perPhoto) {
  const candidates = perPhoto
    .filter(p => p.ok)
    .filter(p => !def.photoClasses || def.photoClasses.includes(p.classification) || def.photoClasses.includes('*'))
    .map(p => ({ value: def.source(p), filename: p.filename, confidence: p.confidence }))
    .filter(c => c.value != null && c.value !== '');

  if (candidates.length === 0) return null;
  const [top] = voteOn(candidates);
  if (!top) return null;
  return {
    field: def.key,
    value: top.value,
    confidence: top.count >= 2 ? 'high' : (top.confidence || 'medium'),
    evidence: top.evidence,
  };
}

// Flooring is special — we aggregate distinct materials rather than a single winner.
function aggregateFlooring(perPhoto) {
  const byRoom = new Map();
  for (const p of perPhoto) {
    if (!p.ok) continue;
    const floors = p.fields?.flooring;
    if (!floors) continue;
    // May be comma-separated (open concept photos)
    const items = String(floors).split(',').map(s => s.trim()).filter(Boolean);
    for (const item of items) {
      const key = item.toLowerCase();
      const g = byRoom.get(key) || { value: item, count: 0, rooms: new Set(), evidence: [] };
      g.count += 1;
      if (p.classification) g.rooms.add(p.classification);
      g.evidence.push(p.filename);
      byRoom.set(key, g);
    }
  }
  const list = [...byRoom.values()].sort((a, b) => b.count - a.count);
  if (list.length === 0) return null;
  return {
    field: 'flooringSummary',
    value: list.map(l => `${l.value} (${l.count})`).join(', '),
    confidence: list[0].count >= 2 ? 'high' : 'medium',
    evidence: list.flatMap(l => l.evidence).slice(0, 6),
    breakdown: list.map(l => ({ material: l.value, count: l.count, rooms: [...l.rooms] })),
  };
}

// Bathrooms: sum piece counts across distinct bathroom photos.
// Heuristic: one photo per bathroom unless two photos classify bathroom AND
// look like the same room (we can't tell from this data). For MVP we list
// each bathroom observation separately and let Jonathan accept the set.
function aggregateBathrooms(perPhoto) {
  const bath = perPhoto.filter(p => p.ok && (p.classification === 'bathroom' || p.classification === 'powder_room'));
  if (bath.length === 0) return null;
  const pieces = bath.map(p => ({
    filename: p.filename,
    pieces: Number(p.fields?.bathroomPieces) || null,
    isPowder: p.classification === 'powder_room',
  })).filter(x => x.pieces);
  if (pieces.length === 0) return null;

  return {
    field: 'bathroomsDetected',
    value: pieces.map(b => `${b.pieces}-piece${b.isPowder ? ' (powder)' : ''}`).join(', '),
    confidence: 'medium',
    evidence: pieces.map(p => p.filename),
    breakdown: pieces,
  };
}

function aggregateKitchen(perPhoto) {
  const kitchens = perPhoto.filter(p => p.ok && p.classification === 'kitchen' && p.fields?.kitchen);
  if (kitchens.length === 0) return null;
  const k = kitchens[0].fields.kitchen; // take first kitchen photo as authoritative
  const parts = [];
  if (k.cabinets)       parts.push(`Cabinets: ${k.cabinets}`);
  if (k.counters)       parts.push(`Counters: ${k.counters}`);
  if (k.backsplash)     parts.push(`Backsplash: ${k.backsplash}`);
  if (k.island === true) parts.push(`Island`);
  if (k.applianceTier)  parts.push(`Appliances: ${k.applianceTier}`);
  if (parts.length === 0) return null;
  return {
    field: 'kitchenSummary',
    value: parts.join(' · '),
    confidence: kitchens.length >= 2 ? 'high' : 'medium',
    evidence: kitchens.map(p => p.filename),
  };
}

function aggregateHvacOutside(perPhoto) {
  const hvac = perPhoto
    .filter(p => p.ok && p.fields?.hvacOutsideCondenser)
    .map(p => ({ ...p.fields.hvacOutsideCondenser, filename: p.filename }))
    .filter(h => h.brand || h.model || h.year || h.tons);
  if (hvac.length === 0) return null;
  const pick = hvac[0];
  const parts = [];
  if (pick.brand) parts.push(pick.brand);
  if (pick.model) parts.push(pick.model);
  if (pick.tons)  parts.push(`${pick.tons} tons`);
  if (pick.year)  parts.push(pick.year);
  return {
    field: 'acUnitOutsideSummary',
    value: parts.join(' / '),
    confidence: 'high',
    evidence: [pick.filename],
  };
}

function aggregateHvacInside(perPhoto) {
  const vals = perPhoto
    .filter(p => p.ok && p.fields?.hvacInsideType)
    .map(p => ({ value: p.fields.hvacInsideType, filename: p.filename, confidence: p.confidence }));
  if (vals.length === 0) return null;
  const [top] = voteOn(vals);
  if (!top) return null;
  return {
    field: 'heatSystem',
    value: top.value,
    confidence: top.count >= 2 ? 'high' : 'medium',
    evidence: top.evidence,
  };
}

function aggregateWaterfront(perPhoto) {
  const wf = perPhoto.filter(p => p.ok && p.fields?.waterfront === true);
  if (wf.length === 0) return null;
  return {
    field: 'waterfront',
    value: 'Yes',
    confidence: wf.length >= 2 ? 'high' : 'medium',
    evidence: wf.map(p => p.filename).slice(0, 4),
  };
}

function aggregateNotableFeatures(perPhoto) {
  const all = new Map();
  for (const p of perPhoto) {
    if (!p.ok) continue;
    const nf = p.fields?.notableFeatures;
    if (!Array.isArray(nf)) continue;
    for (const f of nf) {
      const key = String(f).toLowerCase().trim();
      if (!key) continue;
      const g = all.get(key) || { value: f, evidence: [] };
      g.evidence.push(p.filename);
      all.set(key, g);
    }
  }
  if (all.size === 0) return null;
  const list = [...all.values()].sort((a, b) => b.evidence.length - a.evidence.length);
  return {
    field: 'notableFeatures',
    value: list.map(l => l.value).join(', '),
    confidence: 'medium',
    evidence: list.flatMap(l => l.evidence).slice(0, 8),
    breakdown: list,
  };
}

function buildDescriptive(perPhoto) {
  const snippets = perPhoto
    .filter(p => p.ok && p.descriptive && p.descriptive.trim())
    .map(p => p.descriptive.trim());
  // Deduplicate near-identicals by lowercased prefix
  const seen = new Set();
  const out = [];
  for (const s of snippets) {
    const k = s.toLowerCase().slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function mergeResults(perPhotoList) {
  const suggestions = [];
  for (const def of FIELD_DEFS) {
    const s = aggregateField(def, perPhotoList);
    if (s) suggestions.push(s);
  }
  const flooring = aggregateFlooring(perPhotoList);   if (flooring) suggestions.push(flooring);
  const baths    = aggregateBathrooms(perPhotoList);  if (baths)    suggestions.push(baths);
  const kitchen  = aggregateKitchen(perPhotoList);    if (kitchen)  suggestions.push(kitchen);
  const hvacOut  = aggregateHvacOutside(perPhotoList); if (hvacOut)  suggestions.push(hvacOut);
  const hvacIn   = aggregateHvacInside(perPhotoList);  if (hvacIn)   suggestions.push(hvacIn);
  const wf       = aggregateWaterfront(perPhotoList);  if (wf)       suggestions.push(wf);
  const feats    = aggregateNotableFeatures(perPhotoList); if (feats) suggestions.push(feats);

  const descriptive = buildDescriptive(perPhotoList);

  return {
    promptVersion: PROMPT_VERSION,
    photoCount: perPhotoList.length,
    analyzed: perPhotoList.filter(p => p.ok).length,
    failed:   perPhotoList.filter(p => !p.ok).length,
    suggestions,
    descriptive,
    perPhoto: perPhotoList.map(p => ({
      filename: p.filename, ok: p.ok, classification: p.classification, confidence: p.confidence, error: p.error,
    })),
  };
}
