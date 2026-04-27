// src/config/listing-form-options.js
//
// Pure data — option lists for the Listing Form dropdowns and chip pickers.
// No React, no state, no side effects. Edit a list here, the matching
// dropdown updates everywhere it's used.
//
// Tested for parity 2026-04-24 — values match exactly what was in App.jsx
// before extraction.

export const HEATING_OPTIONS = [
  'Forced Air Gas', 'Forced Air Propane', 'Electric Baseboard', 'Radiant In-Floor',
  'Mini-Split', 'Wood Stove', 'Pellet Stove', 'Oil Furnace', 'Geothermal',
  'Boiler / Radiator',
];

export const AC_OPTIONS = ['Central Air', 'Ductless Mini-Split', 'Window Units', 'None'];

export const APPLIANCE_OPTIONS = [
  'Fridge', 'Stove', 'Dishwasher', 'Microwave', 'Washer', 'Dryer', 'Range Hood',
  'Built-in Oven', 'Wine Fridge', 'Chest Freezer', 'Garburator', 'Water Softener',
  'Central Vac',
];

export const INCLUSION_OPTIONS = [
  'Window Coverings', 'California Shutters', 'Light Fixtures', 'Garage Door Opener',
  'Hot Tub', 'Pool Equipment', 'Storage Shed', 'ELFs', 'Smart Home Devices',
  'Security System', 'Water Treatment System', 'Satellite Dish', 'TV Wall Mount(s)',
  'Sump Pump', 'Built-in Generator', 'Bar Fridge / Beer Fridge', 'Pool Table',
];

export const FOUNDATION_TYPES = [
  'Concrete', 'Concrete Block', 'Poured Concrete', 'Stone', 'Slab', 'Crawl Space',
  'Pier / Post', 'Other',
];

export const ROOF_TYPES = [
  'Asphalt Shingle', 'Metal', 'Cedar Shake', 'Slate', 'Flat / Torch-On', 'Tile', 'Other',
];

export const STYLE_OPTIONS = [
  '2-Storey', '3-Storey', 'Bungalow', 'Raised Bungalow', 'Bungaloft', 'Sidesplit',
  'Backsplit', '1.5 Storey', 'Mobile/Trailer/Modular', 'Other',
];

export const PROPERTY_TYPES = [
  'Detached', 'Semi-Detached', 'Townhouse', 'Condo', 'Bungalow', 'Multi-Family',
  'Vacant Land', 'Farm', 'Cottage / Waterfront', 'Commercial', 'Other',
];

export const BASEMENT_TYPES = ['Full', 'Partial', 'Crawl Space', 'None'];

export const WATER_SOURCES = ['Municipal', 'Drilled Well', 'Dug Well', 'Lake', 'Shared Well', 'Cistern'];

export const SEWER_TYPES = ['Municipal Sewer', 'Septic Tank', 'Holding Tank', 'Septic Bed'];

export const GARAGE_TYPES = ['Attached', 'Detached', 'Built-In', 'Carport', 'None'];

export const FLOORING_TYPES = ['Hardwood', 'Laminate', 'Vinyl Plank', 'Tile', 'Carpet', 'Concrete', 'Other'];

// Per-room detail chips: every room can have these, certain room types add
// extra ones based on name keywords.
export const ROOM_DETAIL_BASE = [
  'Large Window', 'Closet', 'Walk-in Closet', 'Upgraded Lighting',
  'Crown Moulding', 'Pot Lights', 'Freshly Painted', 'Ceiling Fan',
];

export function getRoomDetailOptions(roomName) {
  const n = (roomName || '').toLowerCase();
  const opts = [...ROOM_DETAIL_BASE];
  if (n.includes('bath') || n.includes('washroom') || n.includes('powder')) opts.push('Upgraded Vanity');
  if (n.includes('bed') || n.includes('primary') || n.includes('master'))   opts.push('Feature Wall');
  if (n.includes('kitchen'))                                                 opts.push('Under-Counter Lighting');
  if (n.includes('mechanical') || n.includes('utility') || n.includes('furnace') || n.includes('laundry')) {
    opts.push('Smart Thermostat');
  }
  return opts;
}
