// lib/photo-vision/cluster-prompt.js
//
// Second-pass prompt: takes N photos already classified into the same room
// type (e.g. all bedrooms), and asks Claude to group them by which physical
// room they depict. Returns unique rooms with consolidated fields.

export const CLUSTER_PROMPT_VERSION = 'v1.2026-04-24';

const ROOM_TYPE_LABEL = {
  bedroom: 'Bedroom',
  primary_bedroom: 'Primary Bedroom',
  bathroom: 'Bathroom',
  powder_room: 'Powder Room',
  living: 'Living Room',
  dining: 'Dining Room',
  kitchen: 'Kitchen',
  basement: 'Basement',
  office_den: 'Office / Den',
  laundry: 'Laundry',
  mechanical: 'Mechanical / Utility',
  garage: 'Garage',
  other: 'Other',
};

export function labelFor(classification) {
  return ROOM_TYPE_LABEL[classification] || 'Room';
}

export function buildClusterPrompt(classification, photoCount) {
  const label = labelFor(classification);
  const isBath = classification === 'bathroom' || classification === 'powder_room';
  const isBedroom = classification === 'bedroom' || classification === 'primary_bedroom';

  const roomSpecificTells = isBath
    ? `For bathrooms specifically:
- Count fixtures visible in each photo: toilet, sink, tub, shower. A 4-piece has all four, 3-piece has three, 2-piece has toilet + sink only.
- Tile pattern, grout color, fixture placement, and vanity design are the best tells for "same room, different angle".
- A walk-in shower vs. an enclosed tub/shower combo is a strong discriminator.
- If you see a tub in one photo and a stand-up shower in another, they may still be the SAME 4-piece bath from different angles — look at the fixtures that ARE shared (toilet, sink, vanity, floor tile, paint).`
    : isBedroom
      ? `For bedrooms specifically:
- Linens (bedspread color/pattern) and artwork over the bed are the single strongest "same room" signals.
- Also compare: paint color, window placement, closet door position, flooring, ceiling fan, baseboards.
- If two photos show different bedding but the walls/windows/flooring are identical, it's probably still ONE room photographed before and after staging — assume same room and note the discrepancy in reasoning.`
      : `Compare: paint/wall color, flooring, window placement, trim, ceiling treatment, furniture arrangement, and any decor or fixtures that would not move between rooms.`;

  return `You are looking at ${photoCount} photos that have already been classified as "${label}" from the same property. Your job is to group photos that show the SAME PHYSICAL ROOM together, and list each unique room once.

${roomSpecificTells}

Return ONE valid JSON object and NOTHING ELSE. The shape is:

{
  "rooms": [
    {
      "label": "${label}${isBedroom ? ' 1' : ''}",   // human label; see naming rules below
      "photoIndices": [0, 2],                         // zero-based positions of the photos in the input
      "reasoning": "Both show the same navy-and-gold bedspread and the large framed landscape over the headboard.",
      "flooring": "Hardwood",                         // if visible, otherwise omit
      "features": ["walk-in closet", "ensuite door"], // short list of notable permanent features in this room
      "bathroomPieces": 4,                            // REQUIRED only when classification is bathroom/powder_room; aggregate across the photos in this cluster
      "isEnsuite": true,                              // bathrooms only: true if it appears attached to a bedroom
      "likelyLevel": "Upper"                          // Upper | Main | Lower | Basement | Unknown — best guess from staircases, window light, ceiling height
    }
  ]
}

Naming rules:
- If the classification is "primary_bedroom", label the single cluster "Primary Bedroom".
- Otherwise for multi-room types, number them: "Bedroom 1", "Bedroom 2" (or "4-piece Bath", "3-piece Bath", "2-piece Powder Room" — include the piece count in the bath label).
- For single-instance types (Kitchen, Dining Room, Living Room), just use the label.

Be conservative: if you cannot confidently distinguish two photos as different rooms, group them as the same room. It's better to under-split than over-split. Do not invent rooms. Output ONLY the JSON object.`;
}
