// src/components/form-helpers.jsx
//
// Reusable bits that the Listing Form is built out of. Extracted from App.jsx
// 2026-04-24 so the ListingForm component itself can move next without
// dragging these along.
//
// - defaultFormData: the canonical empty form record. Adding a new field?
//   add it here and every read site picks up the default automatically.
// - ChipSelect: a multi-select rendered as toggleable pills.
// - FormField: a labeled wrapper around any form control.
// - FormSection: a collapsible section card with an icon, title, badge.

import { ChevronUp, ChevronDown } from 'lucide-react';

export function defaultFormData() {
  return {
    propertyId: '', address: '', city: '', postalCode: '',
    mlsNumber: '', listPrice: '', propertyType: '', statusType: '', possessionType: '',
    hstApplicable: '', propertyAsIs: '',
    exclusiveAgreementSigned: '', exclusiveAgreementExpiry: '',
    brokerageRemarks: '',
    lotSize: '', lotDimensions: '',
    lotFrontage: '', lotDepth: '',
    taxes: '', taxYear: '', assessedValue: '',
    sellerName: '', sellerPhone: '', sellerEmail: '',
    sellerName2: '', sellerPhone2: '', sellerEmail2: '', occupancy: '',
    bedrooms: '', bathrooms: '', halfBathrooms: '',
    aboveGradeRooms: '', aboveGradeKitchens: '',
    belowGradeRooms: '', belowGradeBedrooms: '', belowGradeKitchens: '',
    familyRoom: '',
    style: '', foundationType: '', roofType: '', roofAge: '', exteriorMaterial: '',
    sqftAboveGrade: '', sqftBelowGrade: '', totalFinishedSqFt: '',
    plumbing: 'Standard', electricalAmps: '', electricalType: '',
    heatingTypes: [], furnaceAge: '', furnaceOwnedRented: '', furnaceMonthlyCost: '',
    acTypes: [], acOwnedRented: '', acMonthlyCost: '',
    hasFireplace: false, fireplaceType: '', numberOfFireplaces: '',
    hotWaterType: '', hotWaterAge: '', hotWaterOwnedRented: '', hotWaterMonthlyCost: '', rentalItems: '',
    hydroProvider: '', propaneProvider: '', gasProvider: '', internetProvider: '', internetType: '',
    basementType: '', basementFinish: '', basementWalkout: '', basementCeilingHeight: '', basementNotes: '',
    waterSource: '', sewerType: '', wellDetails: '', septicDetails: '',
    septicLastPumped: '', septicLastInspected: '',
    garage: '', garageType: '', garageSpaces: '', drivewaySize: [], drivewayMaterial: [], drivewaySpaces: '',
    appliancesIncluded: [],
    otherInclusions: [], inclusionsNotes: '', exclusions: '',
    hasPool: false, poolType: '', hasHotTub: false,
    visibleUpgrades: '', hiddenUpgrades: '', floorPlanChanges: '',
    rooms: [],
    isWaterfront: false, waterfrontType: '', waterBody: '', waterBodyType: '', waterfrontFootage: '',
    shoreline: '', shorelineExposure: '', dock: '', waterDepth: '',
    waterfrontFeatures: '', waterfrontAccessoryBuildings: '',
    lockboxCode: '', accessNotes: '', showingRestrictions: '', showingInstructions: '',
    signType: '', signLocation: '', riderInfo: '',
    stagingNotes: '', photographyNotes: '',
    additionalNotes: '',
    top5Reasons: '', mlsDescription: '',
    fintracId1Type: '', fintracId1Number: '', fintracId1Expiry: '',
    fintracEmployer: '', fintracOccupation: '',
    sisuTransactionUrl: '',
    status: 'draft', createdAt: '', updatedAt: '',
    // Set when the seller submits their portion via the public seller form
    sellerSubmittedAt: '',
  };
}

export function ChipSelect({ options, selected, onChange, color = '#c8a96e' }) {
  const toggle = (opt) => {
    const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt];
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const active = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: active ? 600 : 400,
            border: `1.5px solid ${active ? color : '#d1d5db'}`,
            background: active ? color : '#fff', color: active ? '#fff' : '#374151',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>{opt}</button>
        );
      })}
    </div>
  );
}

export function FormField({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

export function FormSection({ title, icon: Icon, expanded, onToggle, children, badge }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer',
        background: expanded ? '#fafafa' : '#fff', borderBottom: expanded ? '1px solid #e5e7eb' : 'none',
        transition: 'background 0.15s',
      }}>
        {Icon && <Icon size={16} color="#c8a96e" />}
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', flex: 1 }}>{title}</span>
        {badge && <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: '#c8a96e', padding: '2px 8px', borderRadius: 10 }}>{badge}</span>}
        {expanded ? <ChevronUp size={16} color="#9ca3af" /> : <ChevronDown size={16} color="#9ca3af" />}
      </div>
      {expanded && <div style={{ padding: '16px 18px' }}>{children}</div>}
    </div>
  );
}
