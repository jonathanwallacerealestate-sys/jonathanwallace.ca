// lib/parsers/geowarehouse.js
//
// Pure text parser for GeoWarehouse property report PDFs. Given the raw
// text extracted from a GeoWarehouse report (typically by pdf-parse),
// returns a `fields` object suitable for merging into a Listing Form.
//
// Extracted from server.js 2026-04-24 — verbatim copy, no behavior change.
//
// 2026-05-09: write-side casing/postal/name normalization via lib/util/casing.js
//   so storage is canonical (Title-Case city, McMaster, L9M 1N1) regardless of
//   what the upstream PDF text gave us.

import { titleCaseIfAllCaps, formatPostalCode, normalizeContactName } from '../util/casing.js';

function parseGeoWarehouseText(text) {
  const fields = { _source: 'geowarehouse' };
  const t = text.replace(/\r\n/g, '\n');

  // --- Address & City ---
  // pdf-parse extracts GeoWarehouse text with labels on one line and values on the next.
  // The Property Details section looks like:
  //   GeoWarehouse Address:
  //   PIN:
  //   Land Registry Office:
  //   ...
  //   115  COUNTY 6 RD S
  //   TINY
  //   L0L2J0
  //   583980026
  //   SIMCOE (51)
  // So labels come first in a block, then values follow in order.
  // Best approach: grab address from the cover page header which appears as:
  //   "115  COUNTY 6 RD S, TINY"  (with comma separating address and municipality)
  // or from the Property Address line in the assessment section.
  const headerMatch = t.match(/Property Address:\s*\n\s*(.+?)\n/i);
  if (headerMatch) {
    const fullAddr = headerMatch[1].trim();
    // Format: "115 COUNTY ROAD 6 S TINY ON\nL0L2J0" or "115 COUNTY ROAD 6 S TINY ON"
    // Try to split off municipality + province
    const addrParts = fullAddr.match(/^(.+?)\s+(TINY|MIDLAND|PENETANGUISHENE|TAY|WASAGA BEACH|COLLINGWOOD|SPRINGWATER|ORO-MEDONTE|SEVERN|RAMARA|ORILLIA|BARRIE|INNISFIL|BRADFORD|ESSA|CLEARVIEW|ADJALA-TOSORONTIO|NEW TECUMSETH|GEORGIAN BAY)\s*/i);
    if (addrParts) {
      fields.address = titleCaseIfAllCaps(addrParts[1].trim());
      fields.city = titleCaseIfAllCaps(addrParts[2].trim());
    } else {
      fields.address = titleCaseIfAllCaps(fullAddr.replace(/\s+(ON|ONTARIO)\s*$/i, '').trim());
    }
  }
  // Fallback: use the cover page format "115  COUNTY 6 RD S, TINY"
  if (!fields.address) {
    const coverMatch = t.match(/\n(\d+\s+[A-Z][A-Z0-9\s]+(?:RD|ROAD|ST|STREET|AVE|AVENUE|DR|DRIVE|BLVD|CRES|COURT|CT|WAY|LANE|LN|PL|PLACE|CIRCLE|CIR)\s*\w*)\s*,\s*([A-Z]+)\n/i);
    if (coverMatch) {
      fields.address = titleCaseIfAllCaps(coverMatch[1].replace(/\s+/g, ' ').trim());
      fields.city = titleCaseIfAllCaps(coverMatch[2].trim());
    }
  }
  // Fallback city from cover page (first line after address before PIN)
  if (!fields.city) {
    const cityMatch = t.match(/\n(TINY|MIDLAND|PENETANGUISHENE|TAY|WASAGA BEACH|COLLINGWOOD|SPRINGWATER|ORO-MEDONTE|SEVERN|RAMARA|ORILLIA|BARRIE|INNISFIL)\n/i);
    if (cityMatch) fields.city = titleCaseIfAllCaps(cityMatch[1].trim());
  }

  // --- PIN ---
  const pinMatch = t.match(/PIN\s+(\d{9,})/);
  if (pinMatch) fields.pin = pinMatch[1];

  // --- Legal Description ---
  const legalMatch = t.match(/Legal Description\s*\n\s*(.+?)(?:\nReport Generated)/is);
  if (legalMatch) fields.legalDescription = legalMatch[1].trim().replace(/\n/g, ' ');

  // --- Ownership ---
  const ownerMatch = t.match(/Owner Name:\s*\n\s*(.+?)(?:\n\s*Legal Description|\n\n)/is);
  if (ownerMatch) {
    const names = ownerMatch[1].trim().split(/[;\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length > 0) {
      const parseName = (n) => { const parts = n.split(',').map(p => p.trim()); return parts.length >= 2 ? `${parts[1]} ${parts[0]}` : n; };
      fields.sellerName = normalizeContactName(parseName(names[0]));
      if (names.length > 1) fields.sellerName2 = normalizeContactName(parseName(names[1]));
    }
  }

  // --- Ownership Type ---
  // In the text, labels and values are separate. Look for Freehold/Condominium after "Ownership Type:"
  const ownerTypeMatch = t.match(/(?:Certified \(Land Titles\)|Land Titles Absolute Plus)\s*\n\s*(Freehold|Condominium|Leasehold)/i);
  if (ownerTypeMatch) fields.ownershipType = ownerTypeMatch[1].trim();

  // --- Lot Size ---
  // "Area:\nPerimeter:\nMeasurements:\n115873.38 sq.ft (2.66 ac)"
  // Values appear after the label block. Match the area value directly.
  const areaMatch = t.match(/([\d,.]+)\s*sq\.?ft\.?\s*\(([\d.]+)\s*ac\)/i);
  if (areaMatch) {
    fields.lotSize = `${areaMatch[2]} acres`;
  }

  // --- Frontage & Depth ---
  const frontMatch = t.match(/Frontage:\s*([\d.]+)\s*ft/i);
  if (frontMatch) {
    fields.lotFrontage = frontMatch[1];
  }
  const depthMatch = t.match(/Depth:\s*([\d.]+)\s*ft/i);
  if (depthMatch) {
    fields.lotDepth = depthMatch[1];
  }

  // --- Lot Dimensions from Measurements ---
  // The measurements line looks like: "521.82ft. x 155.95ft. x 207.93ft. x ..."
  const measMatch = t.match(/([\d.]+ft\.\s*x\s*[\d.]+ft\.[\s\S]*?)(?:\nLot Measurement|\n\n)/i);
  if (measMatch) {
    fields.lotDimensions = measMatch[1].replace(/\n/g, ' ').trim();
  } else if (fields.lotFrontage && fields.lotDepth) {
    fields.lotDimensions = `${fields.lotFrontage} x ${fields.lotDepth}`;
  } else if (fields.lotFrontage) {
    fields.lotDimensions = `Frontage: ${fields.lotFrontage} ft`;
  }

  // --- ARN ---
  const arnMatch = t.match(/ARN\s*\n\s*(\d{15,})/i);
  if (arnMatch) fields.arn = arnMatch[1];
  if (!fields.arn) {
    const arnInline = t.match(/(\d{15})/);
    if (arnInline) fields.arn = arnInline[1];
  }

  // --- Assessed Value ---
  // Current Assessment section: "$328,000" appears after "Current Assessment* :"
  const assessMatch = t.match(/Current Assessment\s*\*?\s*:\s*\n?\s*\$([\d,]+)/i);
  if (assessMatch) fields.assessedValue = assessMatch[1].replace(/,/g, '');

  // --- Property Taxes ---
  // "Residential Property Tax Details" section has rows like "2025$2,898"
  // Grab the most recent (last) year's tax — this is the most current data
  const taxSection = t.match(/Residential Property Tax Details\s*\n([\s\S]*?)(?:\nReport Generated|$)/i);
  if (taxSection) {
    const taxRows = [...taxSection[1].matchAll(/(\d{4})\s*\$\s*([\d,]+)/g)];
    if (taxRows.length > 0) {
      const lastRow = taxRows[taxRows.length - 1];
      fields.taxes = lastRow[2].replace(/,/g, '');
      fields.taxYear = lastRow[1]; // Tax year matches the tax amount
    }
  }

  // --- Fallback Taxation Year (from assessment section) ---
  if (!fields.taxYear) {
    const taxBlock = t.match(/Taxation Year\s*Phased-In Assessment[\s\S]*?\n(\d{4})\n/i);
    if (taxBlock) fields.taxYear = taxBlock[1];
  }

  // --- Year Built, Bedrooms, Bathrooms ---
  // Structure table row: "301 1994 3 2 N/A 1"
  // Format: code yearBuilt bedrooms fullBaths halfBaths stories
  const structMatch = t.match(/(\d{3})\s*(\d{4})\s*(\d+)\s*(\d+)\s*(N\/A|\d+)\s*(\d+)/);
  if (structMatch) {
    fields.yearBuilt = structMatch[2];
    fields.bedrooms = structMatch[3];
    const fullBaths = parseInt(structMatch[4]) || 0;
    const halfStr = structMatch[5];
    const halfBaths = halfStr === 'N/A' ? 0 : (parseInt(halfStr) || 0);
    fields.bathrooms = halfBaths > 0 ? `${fullBaths}.${halfBaths}` : String(fullBaths);
  }

  // --- Description / Property Type ---
  // Match the MPAC description line like "Single-family detached (not on water)"
  // Be specific to avoid matching "Assessment Roll Legal Description:"
  const descMatch = t.match(/(?:^|\n)\s*(?:Frontage:[\s\S]*?)Description:\s*(.+)/im)
    || t.match(/(?:Property Code:[\s\S]*?)Description:\s*(.+)/im);
  if (descMatch) {
    const desc = descMatch[1].trim().toLowerCase();
    if (desc.includes('detach')) fields.propertyType = 'Detached';
    else if (desc.includes('semi')) fields.propertyType = 'Semi-Detached';
    else if (desc.includes('town') || desc.includes('row')) fields.propertyType = 'Townhouse';
    else if (desc.includes('condo')) fields.propertyType = 'Condo';
    if (desc.includes('on water') && !desc.includes('not on water')) fields.isWaterfront = true;
  }

  // --- Water & Sewers (GeoWarehouse only knows well/septic vs municipal) ---
  const waterMatch = t.match(/Water Service Type:\s*(.+)/i);
  if (waterMatch) {
    const wt = waterMatch[1].trim().toLowerCase();
    if (wt.includes('well') || wt.includes('private')) fields.waterSource = 'Drilled Well';
    else if (wt.includes('municipal') || wt.includes('public')) fields.waterSource = 'Municipal';
  }
  const sewerMatch = t.match(/Sanitation Type:\s*(.+)/i);
  if (sewerMatch) {
    const st = sewerMatch[1].trim().toLowerCase();
    if (st.includes('septic')) fields.sewerType = 'Septic Tank';
    else if (st.includes('municipal') || st.includes('public')) fields.sewerType = 'Municipal Sewer';
  }
  // Note: garage, exterior, and mechanicals all come from REALM/MLS listing

  // --- Zoning (GeoWarehouse is the authoritative source for zoning) ---
  const zoningMatch = t.match(/Zoning:\s*(.+)/i);
  if (zoningMatch) fields.zoning = zoningMatch[1].trim();

  // --- Site Area (acreage from Enhanced section) ---
  const siteAreaMatch = t.match(/Site Area:\s*(.+)/i);
  if (siteAreaMatch && !fields.lotSize) {
    fields.lotSize = siteAreaMatch[1].trim();
  }

  // --- Postal Code ---
  const postalMatch = t.match(/([A-Z]\d[A-Z]\s*\d[A-Z]\d)/i);
  if (postalMatch) fields.postalCode = formatPostalCode(postalMatch[1]);

  // --- Sales History (most recent sale) ---
  const saleMatch = t.match(/Sales History[\s\S]*?(\w+\s+\d+,\s*\d{4})\s*\$([\d,]+)\s*Transfer/i);
  if (saleMatch) {
    fields.lastSaleDate = saleMatch[1].trim();
    fields.lastSalePrice = saleMatch[2].replace(/,/g, '');
  }

  return fields;
}

export { parseGeoWarehouseText };
