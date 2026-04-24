// lib/photo-vision/index.js
//
// Vision extraction over listing photos. See README.md for the flow.

import { buildPrompt, PROMPT_VERSION } from './prompt.js';
import { buildClusterPrompt, CLUSTER_PROMPT_VERSION, labelFor } from './cluster-prompt.js';

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

// ─── Clustering (second pass) ───

// Room types where two or more photos plausibly = two or more physical rooms.
// (Kitchens almost always = 1 room even with many photos.)
const MULTI_ROOM_POSSIBLE = new Set([
  'bedroom', 'primary_bedroom',
  'bathroom', 'powder_room',
  'basement', 'office_den',
]);

// Room types we should return as a single room when present (no clustering
// needed, just flatten).
const SINGLE_ROOM_TYPES = new Set([
  'kitchen', 'living', 'dining', 'laundry', 'mechanical', 'garage',
]);

// Don't emit rooms for these classifications.
const NON_ROOM_TYPES = new Set([
  'exterior_front', 'exterior_back', 'exterior_side', 'exterior_detail',
  'aerial', 'yard_landscape', 'waterfront', 'deck_patio',
  'staircase', 'hallway_foyer', 'other',
]);

export async function clusterRoomsOfType(photos, classification, ctx = {}) {
  // photos: [{ filename, buffer, perPhoto }]
  const { anthropic, model = 'claude-haiku-4-5-20251001', logger = console } = ctx;
  if (!photos || photos.length === 0) return [];

  // Single photo or no anthropic client: flatten into one room.
  if (photos.length === 1 || !anthropic) {
    const p = photos[0];
    const name = nameSingleton(classification, photos[0]?.perPhoto);
    return [{
      label: name.label,
      photoFilenames: photos.map(x => x.filename),
      flooring: pickFlooring(photos.map(x => x.perPhoto)),
      features: pickFeatures(photos.map(x => x.perPhoto)),
      bathroomPieces: pickBathroomPieces(photos.map(x => x.perPhoto), classification),
      isEnsuite: classification === 'bathroom' ? null : false,
      likelyLevel: guessLevel(classification),
      reasoning: 'single photo',
    }];
  }

  try {
    const content = [];
    for (let i = 0; i < photos.length; i++) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaTypeFor(photos[i].filename),
          data: photos[i].buffer.toString('base64'),
        },
      });
      content.push({ type: 'text', text: `Photo ${i}: ${photos[i].filename}` });
    }
    content.push({ type: 'text', text: buildClusterPrompt(classification, photos.length) });

    const msg = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });
    const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.rooms)) {
      logger.warn(`[photo-vision] cluster parse failed for ${classification}; raw: ${text.slice(0, 200)}`);
      // Fallback: treat every photo as its own room
      return photos.map((p, i) => ({
        label: `${labelFor(classification)} ${i + 1}`,
        photoFilenames: [p.filename],
        flooring: pickFlooring([p.perPhoto]),
        features: pickFeatures([p.perPhoto]),
        bathroomPieces: pickBathroomPieces([p.perPhoto], classification),
        isEnsuite: null,
        likelyLevel: guessLevel(classification),
        reasoning: 'cluster parse failed — each photo treated as own room',
      }));
    }

    // Map indices → filenames, enrich with per-photo data we already have.
    return parsed.rooms.map((room, idx) => {
      const indices = Array.isArray(room.photoIndices) ? room.photoIndices.filter(i => Number.isInteger(i) && i >= 0 && i < photos.length) : [];
      const photoFilenames = indices.map(i => photos[i].filename);
      const perPhotos = indices.map(i => photos[i].perPhoto);
      return {
        label: room.label || `${labelFor(classification)}${indices.length > 0 ? ' ' + (idx + 1) : ''}`,
        photoFilenames,
        flooring: room.flooring || pickFlooring(perPhotos),
        features: Array.isArray(room.features) ? room.features : pickFeatures(perPhotos),
        bathroomPieces: Number.isFinite(room.bathroomPieces) ? room.bathroomPieces : pickBathroomPieces(perPhotos, classification),
        isEnsuite: typeof room.isEnsuite === 'boolean' ? room.isEnsuite : null,
        likelyLevel: room.likelyLevel || guessLevel(classification),
        reasoning: room.reasoning || '',
      };
    });
  } catch (err) {
    logger.warn(`[photo-vision] clusterRoomsOfType(${classification}) error: ${err.message}`);
    return photos.map((p, i) => ({
      label: `${labelFor(classification)} ${i + 1}`,
      photoFilenames: [p.filename],
      flooring: pickFlooring([p.perPhoto]),
      features: pickFeatures([p.perPhoto]),
      bathroomPieces: pickBathroomPieces([p.perPhoto], classification),
      isEnsuite: null,
      likelyLevel: guessLevel(classification),
      reasoning: 'cluster api error — each photo treated as own room',
    }));
  }
}

function pickFlooring(perPhotos) {
  for (const p of perPhotos) {
    if (p?.fields?.flooring) return String(p.fields.flooring).split(',')[0].trim();
  }
  return '';
}
function pickFeatures(perPhotos) {
  const bag = new Set();
  for (const p of perPhotos) {
    const nf = p?.fields?.notableFeatures;
    if (Array.isArray(nf)) for (const f of nf) bag.add(String(f));
  }
  return [...bag];
}
function pickBathroomPieces(perPhotos, cls) {
  if (cls !== 'bathroom' && cls !== 'powder_room') return null;
  // Take the max piece-count observed — the most complete angle wins.
  let max = 0;
  for (const p of perPhotos) {
    const n = Number(p?.fields?.bathroomPieces);
    if (n > max) max = n;
  }
  return max || null;
}
function guessLevel(cls) {
  if (cls === 'basement' || cls === 'mechanical') return 'Basement';
  if (cls === 'bedroom' || cls === 'primary_bedroom') return 'Upper';
  if (cls === 'garage') return 'Main';
  if (cls === 'laundry') return 'Main';
  if (['kitchen', 'living', 'dining'].includes(cls)) return 'Main';
  return 'Main';
}
function nameSingleton(cls, perPhoto) {
  if (cls === 'primary_bedroom') return { label: 'Primary Bedroom' };
  if (cls === 'bedroom')         return { label: 'Bedroom' };
  if (cls === 'bathroom') {
    const n = Number(perPhoto?.fields?.bathroomPieces);
    return { label: n ? `${n}-piece Bath` : 'Bath' };
  }
  if (cls === 'powder_room')     return { label: '2-piece Powder Room' };
  if (cls === 'kitchen')         return { label: 'Kitchen' };
  if (cls === 'living')          return { label: 'Living Room' };
  if (cls === 'dining')          return { label: 'Dining Room' };
  if (cls === 'laundry')         return { label: 'Laundry' };
  if (cls === 'mechanical')      return { label: 'Mechanical Room' };
  if (cls === 'garage')          return { label: 'Garage' };
  if (cls === 'office_den')      return { label: 'Office / Den' };
  if (cls === 'basement')        return { label: 'Basement' };
  return { label: labelFor(cls) };
}

// Drive clustering across every room-type group. Returns a flat rooms[] list.
// `buffersByFilename` is a Map<filename, Buffer>.
export async function clusterAllRooms(perPhotoResults, buffersByFilename, ctx = {}) {
  const ok = perPhotoResults.filter(p => p.ok && p.classification);
  const byClass = new Map();
  for (const p of ok) {
    if (NON_ROOM_TYPES.has(p.classification)) continue;
    const g = byClass.get(p.classification) || [];
    g.push(p);
    byClass.set(p.classification, g);
  }

  const all = [];
  for (const [cls, items] of byClass) {
    const photos = items.map(i => ({
      filename: i.filename,
      buffer: buffersByFilename.get(i.filename),
      perPhoto: i,
    })).filter(x => x.buffer); // drop any that lost their buffer (shouldn't happen)

    if (photos.length === 0) continue;

    // Single-room types: flatten to one room, never call clustering.
    if (SINGLE_ROOM_TYPES.has(cls) || !MULTI_ROOM_POSSIBLE.has(cls)) {
      const name = nameSingleton(cls, photos[0].perPhoto);
      all.push({
        label: name.label,
        photoFilenames: photos.map(p => p.filename),
        flooring: pickFlooring(photos.map(p => p.perPhoto)),
        features: pickFeatures(photos.map(p => p.perPhoto)),
        bathroomPieces: pickBathroomPieces(photos.map(p => p.perPhoto), cls),
        isEnsuite: null,
        likelyLevel: guessLevel(cls),
        reasoning: photos.length > 1 ? `all ${photos.length} photos assumed same ${cls}` : '',
      });
      continue;
    }

    // Multi-room-possible types: cluster via Claude.
    const clusters = await clusterRoomsOfType(photos, cls, ctx);
    for (const c of clusters) all.push(c);
  }

  // Number duplicate bedrooms/bathrooms for clarity: "Bedroom 1", "Bedroom 2", ...
  const counts = new Map();
  for (const r of all) {
    const base = String(r.label).trim();
    // Don't renumber primary / powder / kitchen / dining
    if (/^(Primary Bedroom|2-piece Powder Room|Kitchen|Dining Room|Living Room|Office \/ Den|Basement|Laundry|Mechanical Room|Garage)$/i.test(base)) continue;
    const key = base.replace(/\s+\d+$/, '');
    const seen = counts.get(key) || 0;
    counts.set(key, seen + 1);
  }
  const running = new Map();
  for (const r of all) {
    const base = String(r.label).replace(/\s+\d+$/, '');
    if (/^(Primary Bedroom|2-piece Powder Room|Kitchen|Dining Room|Living Room|Office \/ Den|Basement|Laundry|Mechanical Room|Garage)$/i.test(base)) continue;
    if ((counts.get(base) || 0) <= 1) continue;
    const n = (running.get(base) || 0) + 1;
    running.set(base, n);
    r.label = `${base} ${n}`;
  }

  return all;
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

export function mergeResults(perPhotoList, clusteredRooms = null) {
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
    clusterPromptVersion: CLUSTER_PROMPT_VERSION,
    photoCount: perPhotoList.length,
    analyzed: perPhotoList.filter(p => p.ok).length,
    failed:   perPhotoList.filter(p => !p.ok).length,
    suggestions,
    descriptive,
    rooms: Array.isArray(clusteredRooms) ? clusteredRooms : [],
    perPhoto: perPhotoList.map(p => ({
      filename: p.filename, ok: p.ok, classification: p.classification, confidence: p.confidence, error: p.error,
    })),
  };
}
