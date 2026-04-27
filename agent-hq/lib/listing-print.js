// lib/listing-print.js
//
// Pure HTML rendering for the printable listing sheet served at
// GET /api/listing-form/:id/print. Side-effect free — given a listing-form
// JSON, returns a self-contained HTML string with embedded CSS and an
// auto-print script.
//
// Extracted from server.js 2026-04-24 — verbatim copy, no behavior change.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderPrintHtml(form) {
  const fullAddress = [form.address, form.city, form.postalCode].filter(Boolean).join(', ');
  const fmtMoney = (v) => {
    if (v == null || v === '') return '';
    const n = Number(String(v).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n === 0) return String(v);
    return `$${n.toLocaleString()}`;
  };
  const detail = (label, value) => value
    ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`
    : '';

  const rooms = Array.isArray(form.rooms) ? form.rooms : [];
  const roomRows = rooms.map(r => `
    <tr>
      <td><strong>${esc(r.name || '')}</strong></td>
      <td>${esc(r.level || '')}</td>
      <td>${esc(r.dimensions || '')}</td>
      <td>${esc(r.flooring || '')}</td>
      <td>${esc(Array.isArray(r.features) ? r.features.join(', ') : (r.features || ''))}</td>
    </tr>`).join('');

  const heatList = Array.isArray(form.heatingTypes) ? form.heatingTypes.join(', ') : '';
  const acList = Array.isArray(form.acTypes) ? form.acTypes.join(', ') : '';
  const applianceList = Array.isArray(form.appliancesIncluded) ? form.appliancesIncluded.join(', ') : '';
  const otherList = Array.isArray(form.otherInclusions) ? form.otherInclusions.join(', ') : '';

  const waterfrontBlock = form.isWaterfront
    ? `<section>
        <h2>Waterfront</h2>
        <table class="kv">
          ${detail('Water Body', form.waterBody)}
          ${detail('Water Body Type', form.waterBodyType)}
          ${detail('Frontage', form.waterfrontFootage)}
          ${detail('Shoreline', form.shoreline)}
          ${detail('Shoreline Exposure', form.shorelineExposure)}
          ${detail('Dock', form.dock)}
          ${detail('Water Depth', form.waterDepth)}
          ${detail('Features', form.waterfrontFeatures)}
        </table>
      </section>` : '';

  const remarksBlock = form.mlsDescription || form.top5Reasons
    ? `<section class="keep-together">
        ${form.top5Reasons ? `<h2>Top 5 Reasons</h2><div class="prose">${esc(form.top5Reasons).replace(/\n/g,'<br/>')}</div>` : ''}
        ${form.mlsDescription ? `<h2>Description</h2><div class="prose">${esc(form.mlsDescription).replace(/\n/g,'<br/>')}</div>` : ''}
      </section>` : '';

  const inclusionsBlock = (applianceList || otherList || form.inclusionsNotes || form.exclusions)
    ? `<section class="keep-together">
        <h2>Inclusions &amp; Exclusions</h2>
        <table class="kv">
          ${detail('Appliances Included', applianceList)}
          ${detail('Other Inclusions', otherList)}
          ${detail('Notes', form.inclusionsNotes)}
          ${detail('Exclusions', form.exclusions)}
        </table>
      </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(form.address || 'Listing')} — Listing Sheet</title>
<style>
  @page { size: Letter; margin: 0.5in; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.45; }
  .sheet { max-width: 7.5in; margin: 0 auto; padding: 0.25in 0.15in; }
  header { border-bottom: 2px solid #c8a96e; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { margin: 0 0 4px 0; font-size: 22pt; font-weight: 700; color: #111827; }
  .subline { font-size: 10pt; color: #6b7280; }
  .price { float: right; font-size: 18pt; font-weight: 700; color: #c8a96e; margin-top: 4px; }
  .summary { display: flex; gap: 0; margin: 12px 0 18px 0; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .summary > div { flex: 1; padding: 8px 10px; border-right: 1px solid #e5e7eb; text-align: center; }
  .summary > div:last-child { border-right: none; }
  .summary .label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280; margin-bottom: 3px; }
  .summary .value { font-size: 12pt; font-weight: 700; color: #111827; }
  section { margin-bottom: 14px; page-break-inside: avoid; }
  section.keep-together { page-break-inside: avoid; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; margin: 0 0 6px 0; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th, table.kv td { text-align: left; font-size: 10pt; padding: 3px 4px; vertical-align: top; }
  table.kv th { width: 42%; color: #4b5563; font-weight: 600; }
  table.kv td { color: #111827; }
  table.rooms { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.rooms th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; font-weight: 600; }
  table.rooms td { font-size: 10pt; padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .two-col { display: flex; gap: 16px; }
  .two-col > section { flex: 1; }
  .prose { font-size: 10.5pt; line-height: 1.55; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print {
    .no-print { display: none; }
    a[href]:after { content: ''; }
  }
  .no-print-bar { background: #fffbf0; border: 1px solid #f0dca0; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 11pt; color: #92730a; display: flex; justify-content: space-between; align-items: center; }
  .no-print-bar button { padding: 6px 14px; border-radius: 6px; border: 1px solid #c8a96e; background: #c8a96e; color: #fff; font-size: 10pt; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="no-print-bar no-print">
      <span>Print dialog should open automatically. Pick <strong>Save as PDF</strong> as the destination.</span>
      <button onclick="window.print()">Print again</button>
    </div>
    <header>
      ${form.listPrice ? `<div class="price">${fmtMoney(form.listPrice)}</div>` : ''}
      <h1>${esc(form.address || 'Listing')}</h1>
      <div class="subline">
        ${esc([form.city, form.postalCode].filter(Boolean).join(' · '))}
        ${form.mlsNumber ? ` · MLS® ${esc(form.mlsNumber)}` : ''}
        ${form.propertyType ? ` · ${esc(form.propertyType)}` : ''}
      </div>
    </header>

    <div class="summary">
      <div><div class="label">Beds</div><div class="value">${esc(form.bedrooms || '—')}</div></div>
      <div><div class="label">Baths</div><div class="value">${esc(form.bathrooms || '—')}</div></div>
      <div><div class="label">Sq Ft</div><div class="value">${esc(form.totalFinishedSqFt || form.sqftAboveGrade || '—')}</div></div>
      <div><div class="label">Lot</div><div class="value">${esc(form.lotSize || form.lotDimensions || '—')}</div></div>
      <div><div class="label">Year</div><div class="value">${esc(form.yearBuilt || '—')}</div></div>
      <div><div class="label">Taxes</div><div class="value">${esc(fmtMoney(form.taxes) || '—')}${form.taxYear ? ` <span style="font-size:8pt;color:#6b7280">(${esc(form.taxYear)})</span>` : ''}</div></div>
    </div>

    <div class="two-col">
      <section>
        <h2>Property</h2>
        <table class="kv">
          ${detail('Style', form.style)}
          ${detail('Year Built', form.yearBuilt)}
          ${detail('Foundation', form.foundationType)}
          ${detail('Exterior', form.exteriorMaterial)}
          ${detail('Roof', [form.roofType, form.roofAge ? `(${form.roofAge})` : ''].filter(Boolean).join(' '))}
          ${detail('Lot Size', form.lotSize)}
          ${detail('Lot Dimensions', form.lotDimensions)}
          ${detail('Zoning', form.zoning)}
          ${detail('PIN', form.pin)}
          ${detail('Legal', form.legalDescription)}
          ${detail('Sq Ft Above Grade', form.sqftAboveGrade)}
          ${detail('Sq Ft Below Grade', form.sqftBelowGrade)}
          ${detail('Total Finished Sq Ft', form.totalFinishedSqFt)}
        </table>
      </section>
      <section>
        <h2>Systems</h2>
        <table class="kv">
          ${detail('Heating', heatList)}
          ${detail('Furnace Age', form.furnaceAge)}
          ${detail('Furnace', form.furnaceOwnedRented)}
          ${detail('A/C', acList)}
          ${detail('Fireplace', form.hasFireplace ? (form.fireplaceType || 'Yes') : '')}
          ${detail('Hot Water', [form.hotWaterType, form.hotWaterAge, form.hotWaterOwnedRented].filter(Boolean).join(' · '))}
          ${detail('Water', form.waterSource)}
          ${detail('Sewer', form.sewerType)}
          ${detail('Electrical', [form.electricalAmps, form.electricalType].filter(Boolean).join(' · '))}
          ${detail('Basement', [form.basementType, form.basementFinish, form.basementWalkout].filter(Boolean).join(' · '))}
          ${detail('Garage', [form.garageType, form.garageSpaces ? form.garageSpaces + ' car' : ''].filter(Boolean).join(' '))}
          ${detail('Driveway', [form.drivewayMaterial, form.drivewaySpaces ? form.drivewaySpaces + ' spaces' : ''].filter(Boolean).join(' · '))}
          ${detail('Rental Items', form.rentalItems)}
        </table>
      </section>
    </div>

    ${rooms.length > 0 ? `
    <section>
      <h2>Room-by-Room</h2>
      <table class="rooms">
        <thead>
          <tr>
            <th style="width: 22%;">Room</th>
            <th style="width: 12%;">Level</th>
            <th style="width: 14%;">Dimensions</th>
            <th style="width: 18%;">Flooring</th>
            <th>Features</th>
          </tr>
        </thead>
        <tbody>${roomRows}</tbody>
      </table>
    </section>` : ''}

    ${waterfrontBlock}
    ${inclusionsBlock}
    ${form.visibleUpgrades || form.hiddenUpgrades || form.floorPlanChanges ? `
    <section class="keep-together">
      <h2>Upgrades</h2>
      <table class="kv">
        ${detail('Visible Upgrades', form.visibleUpgrades)}
        ${detail('Hidden Upgrades', form.hiddenUpgrades)}
        ${detail('Floor Plan Changes', form.floorPlanChanges)}
      </table>
    </section>` : ''}
    ${remarksBlock}
    ${form.showingInstructions || form.showingRestrictions || form.lockboxCode ? `
    <section class="keep-together">
      <h2>Showings</h2>
      <table class="kv">
        ${detail('Instructions', form.showingInstructions)}
        ${detail('Restrictions', form.showingRestrictions)}
        ${detail('Lockbox', form.lockboxCode)}
      </table>
    </section>` : ''}

    <footer>
      <span>${esc(fullAddress)}</span>
      <span>Generated ${new Date().toLocaleString()}</span>
    </footer>
  </div>
  <script>
    // Open the print dialog automatically as soon as the page is painted.
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;
}

export { renderPrintHtml, esc };
