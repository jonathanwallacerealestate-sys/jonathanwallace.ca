// lib/photo-vision/prompt.js
//
// The vision prompt. Kept in its own file so Jonathan / future Claude can
// iterate on wording without touching the dispatcher code.

export const PROMPT_VERSION = 'v1.2026-04-24';

export function buildPrompt(ctx = {}) {
  const addressLine = ctx.address ? `Property: ${ctx.address}${ctx.city ? ', ' + ctx.city : ''}.` : '';

  return `You are analyzing a real estate listing photo for a property in Ontario, Canada (Georgian Bay / Simcoe County — Midland, Penetanguishene, Tiny, Tay). Your job is to extract any factual detail the photo reveals so it can help populate an MLS-style data sheet.

${addressLine}

Return ONE valid JSON object and NOTHING ELSE. No prose, no markdown fences. The shape is:

{
  "classification": "<one of: exterior_front | exterior_back | exterior_side | exterior_detail | aerial | kitchen | living | dining | bedroom | primary_bedroom | bathroom | powder_room | basement | laundry | mechanical | garage | deck_patio | yard_landscape | waterfront | staircase | hallway_foyer | office_den | other>",
  "fields": {
     // Only include keys you can see with reasonable confidence.
     // Use these key names so they map to the data sheet. Leave out anything not visible.
     "roofType": "e.g. Asphalt Shingle | Metal | Cedar Shake | Tile | Flat Membrane",
     "roofCondition": "newer | mid-life | aged | worn",
     "exteriorMaterial": "e.g. Brick, Vinyl Siding, Board and Batten, Stone, Stucco, Wood",
     "foundationType": "Concrete | Concrete Block | Poured Concrete | Stone | Slab | Crawl Space",
     "flooring": "Hardwood | Engineered Hardwood | Luxury Vinyl Plank | Laminate | Tile | Stone | Carpet | Polished Concrete",
     "kitchen": {
       "cabinets": "Shaker white | Flat-panel oak | ... (short description)",
       "counters": "Granite | Quartz | Laminate | Butcher Block | Marble | ...",
       "backsplash": "e.g. Subway tile, Quartz slab, ...",
       "island": true,
       "applianceTier": "Standard | Stainless | Panel-ready premium | ..."
     },
     "bathroomPieces": 2 | 3 | 4 | 5,    // count fixtures in this bathroom only: toilet, sink, tub, shower
     "hvacOutsideCondenser": { "brand": "...", "model": "...", "year": "YYYY or null", "tons": "e.g. 2.5" },
     "hvacInsideType": "Forced Air Gas | Heat Pump | Boiler | Electric Baseboard | ...",
     "waterfront": true | false,
     "notableFeatures": ["cathedral ceiling", "exposed beams", "floor-to-ceiling windows", "fireplace - gas insert", "..."]
  },
  "descriptive": "<one short sentence in listing-copy voice describing the most compelling thing this photo shows — for later composition of the MLS description. Do NOT reuse cliches like 'immaculate' or 'won't last'. If nothing stands out, return ''>",
  "confidence": "high | medium | low",
  "notes": "<optional one-line caveat if something is ambiguous or the photo is low-quality>"
}

Rules:
- Classify honestly. "other" is fine when the photo is a staging vignette or a closeup that isn't clearly one room.
- If multiple rooms are visible in one photo (open concept), return the dominant room in classification and list all visible flooring types in the flooring field separated by commas.
- For roof and foundation age: use the band words, never a specific year.
- NEVER guess sqft, beds, baths total, year built, taxes, lot dimensions — these come from the data sheet, not photos.
- NEVER call something "renovated" unless the finishes look current. "Updated" is safer.
- For bathrooms: count ONE photo's visible fixtures as its own piece count. The server will aggregate across multiple bathroom photos.
- For outside HVAC: read the data plate only if legible. Return null for any field you can't read — do not guess.
- Output ONLY the JSON object.`;
}
