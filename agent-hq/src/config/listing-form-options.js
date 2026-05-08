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

// Panel amp options — 60/100/200 are the standard residential ratings. Fuses
// covers older homes that haven't been upgraded to a breaker panel.
export const ELECTRICAL_AMP_OPTIONS = ['60', '100', '200', 'Fuses'];

export const ELECTRICAL_TYPE_OPTIONS = ['Breakers', 'Fuses', 'Mixed'];

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

// ─────────────────────────────────────────────────────────────────
// SELLER FORM — public-facing form filled by the seller via emailed link
// ─────────────────────────────────────────────────────────────────
//
// The seller fills a curated subset of the master listing form. This list is
// the SINGLE SOURCE OF TRUTH used by both the SellerForm component AND the
// public POST endpoint to whitelist writes. A field NOT in this list cannot
// be written through the public seller endpoint, so a malicious payload
// can't overwrite Jonathan's master fields.
//
// Section labels here also drive the SellerForm UI grouping.
export const SELLER_FIELDS = [
  // Verify property facts
  'taxes',
  // Confirm contact details
  'sellerName', 'sellerPhone', 'sellerEmail',
  'sellerName2', 'sellerPhone2', 'sellerEmail2',
  // Electrical
  'electricalAmps', 'electricalType',
  // Roof
  'roofAge',
  // Septic (only if on septic)
  'septicLastPumped', 'septicLastInspected', 'septicDetails',
  // Furnace
  'furnaceAge', 'furnaceOwnedRented', 'furnaceMonthlyCost',
  // AC
  'acOwnedRented', 'acMonthlyCost',
  // Hot water tank
  'hotWaterType', 'hotWaterAge', 'hotWaterOwnedRented', 'hotWaterMonthlyCost',
  'rentalItems',
  // Utility & service providers
  'hydroProvider', 'propaneProvider', 'gasProvider', 'internetProvider', 'internetType',
  // Inclusions
  'appliancesIncluded', 'otherInclusions', 'inclusionsNotes',
  // Exclusions
  'exclusions',
  // Recent renovations
  'visibleUpgrades', 'hiddenUpgrades', 'floorPlanChanges',
];

// Section grouping for the SellerForm UI. Each entry: { title, fields }.
// Fields here MUST appear in SELLER_FIELDS above (the whitelist). Order is
// the order the seller sees them.
export const SELLER_FORM_SECTIONS = [
  {
    title: 'Confirm your contact details',
    description: 'Make sure we have the best way to reach you.',
    fields: ['sellerName', 'sellerPhone', 'sellerEmail', 'sellerName2', 'sellerPhone2', 'sellerEmail2'],
  },
  {
    title: 'Verify property taxes',
    description: 'What were the property taxes for the most recent year?',
    fields: ['taxes'],
  },
  {
    title: 'Electrical panel',
    description: '100A or 200A is most common. Older homes may have fuses.',
    fields: ['electricalAmps', 'electricalType'],
  },
  {
    title: 'Roof',
    description: 'Roughly how old is the current roof?',
    fields: ['roofAge'],
  },
  {
    title: 'Septic system (skip if on municipal sewer)',
    description: 'When was the septic last pumped and inspected?',
    fields: ['septicLastPumped', 'septicLastInspected', 'septicDetails'],
  },
  {
    title: 'Furnace',
    description: 'Age, and whether it’s owned or rented.',
    fields: ['furnaceAge', 'furnaceOwnedRented', 'furnaceMonthlyCost'],
  },
  {
    title: 'Air conditioning',
    description: 'Owned or rented? Skip if you don’t have AC.',
    fields: ['acOwnedRented', 'acMonthlyCost'],
  },
  {
    title: 'Hot water tank',
    description: 'Gas or electric, owned or rented, and any other rental items.',
    fields: ['hotWaterType', 'hotWaterAge', 'hotWaterOwnedRented', 'hotWaterMonthlyCost', 'rentalItems'],
  },
  {
    title: 'Utility & service providers',
    description: 'Who do you pay for hydro, gas/propane, and internet?',
    fields: ['hydroProvider', 'propaneProvider', 'gasProvider', 'internetProvider', 'internetType'],
  },
  {
    title: 'What’s included in the sale?',
    description: 'Appliances and other items staying with the home.',
    fields: ['appliancesIncluded', 'otherInclusions', 'inclusionsNotes'],
  },
  {
    title: 'What’s NOT included?',
    description: 'Anything you’re taking with you (chandelier, mirror, beer fridge, etc.).',
    fields: ['exclusions'],
  },
  {
    title: 'Recent renovations',
    description: 'What’s been updated and roughly when?',
    fields: ['visibleUpgrades', 'hiddenUpgrades', 'floorPlanChanges'],
  },
];

// ─── Sisu Draft 100a calibrated options (probed live 2026-05-07) ───
// Use these so Agent HQ's room dropdowns produce values that match Sisu's
// option text exactly — avoids the "option_not_found" failures we saw in
// the autofill skill's first run.
export const SISU_ROOM_TYPE_OPTIONS = [
  'Attic', 'Bath 2pc', 'Bath 3pc', 'Bath 4pc', 'Bath 5+pc', 'Bedroom',
  'Breakfast Area', 'Cold Room', 'Den', 'Dinette', 'Dining Room',
  'Eat-in Kitchen', 'Ensuite', 'Family Room', 'Foyer', 'Games Room',
  'Great Room', 'Home Theatre/Media Room', 'Kitchen', 'Kitchen/Dining',
  'Laundry', 'Library', 'Living Room', 'Loft', 'Mudroom', 'Office',
  'Other', 'Primary Bedroom', 'Recreation Room', 'Storage Room'
];

export const SISU_ROOM_LEVEL_OPTIONS = [
  'Main Level', 'Second Level', 'Third Level', 'Fourth Level', 'Lower Level', 'Basement'
];

// ─── Sisu Driveway dropdown options (probed live 2026-05-08) ───
// Driveway Size in Agent HQ → Sisu's "Driveway/Parking" multiselect (11 options)
export const SISU_DRIVEWAY_PARKING_OPTIONS = [
  'Available', 'Circular', 'Front Yard (Legal)', 'Lane', 'Mutual',
  'None', 'Other', 'Private Double', 'Private Single', 'Private Triple', 'Right-Of-Way'
];

// Driveway Material in Agent HQ → Sisu's "Driveway Type" multiselect (6 options)
export const SISU_DRIVEWAY_MATERIAL_OPTIONS = [
  'Asphalt', 'Concrete', 'Gravel', 'Interlock', 'None', 'Other'
];

// Sign Install — Sisu uses Yes/No (per Jonathan's spec)
export const SIGN_INSTALL_OPTIONS = ['No', 'Yes'];

