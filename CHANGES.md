# Technical Changes - Customer Default Notes Feature

## Overview

This document details the exact code changes made to implement customer default notes on tickets.

---

## File 1: `netlify/functions/customers.js`

### Change Summary
Added `defaultNote` field to customer data mapping.

### Location
**Line 86**

### Before
```javascript
// Linked products
allowedProducts: record.fields['Allowed Products'] || [],

// Notes
billingNotes: record.fields['Billing Notes'] || '',

// v2.2: Auto-email ticket on close
autoEmailTicket: record.fields['Auto Email Ticket'] || false
```

### After
```javascript
// Linked products
allowedProducts: record.fields['Allowed Products'] || [],

// Notes
defaultNote: record.fields['Default Note'] || '',        // ← ADDED
billingNotes: record.fields['Billing Notes'] || '',

// v2.2: Auto-email ticket on close
autoEmailTicket: record.fields['Auto Email Ticket'] || false
```

### Impact
- API endpoint `/api/customers` now returns `defaultNote` property for each customer
- Frontend can access customer default notes via CUSTOMERS array
- No breaking changes - adds new optional field

### Airtable Mapping
| Airtable Field | JavaScript Property | Type |
|----------------|-------------------|------|
| `Default Note` | `defaultNote` | String |

---

## File 2: `netlify/functions/create-ticket.js`

### Change Summary
Added `Customer Note` field to optional fields when creating tickets.

### Location
**Lines 113-116**

### Before
```javascript
// Truck - save as text field (optional - may not exist)
if (ticketData.truck) {
  optionalFields['Truck Text'] = sanitize(ticketData.truck);
}

// Freight fields (optional - for when Beaver Pumice arranges trucking)
```

### After
```javascript
// Truck - save as text field (optional - may not exist)
if (ticketData.truck) {
  optionalFields['Truck Text'] = sanitize(ticketData.truck);
}

// Customer Note (optional - may not exist)              // ← ADDED
if (ticketData.customerNote) {                           // ← ADDED
  optionalFields['Customer Note'] = sanitize(ticketData.customerNote); // ← ADDED
}                                                        // ← ADDED

// Freight fields (optional - for when Beaver Pumice arranges trucking)
```

### Impact
- When frontend sends `customerNote` in request body, it gets saved to Airtable
- Uses existing sanitization helper (max 500 chars, trimmed)
- Placed in `optionalFields` so deployment works even if field doesn't exist yet
- Will retry without optional fields if Airtable returns "Unknown field" error

### Data Flow
```
Frontend (index.html)
  → ticketData.customerNote: "Granite requires signature"
    → POST /api/tickets/create
      → create-ticket.js
        → Airtable field: "Customer Note"
```

### Airtable Mapping
| Frontend Property | Airtable Field | Processing |
|------------------|----------------|------------|
| `ticketData.customerNote` | `Customer Note` | sanitize() - trim, max 500 chars |

---

## File 3: `index.html`

### Change Summary
Multiple changes to show customer note preview and pass it during ticket creation.

---

### Change 3A: Yellow Preview Box HTML

**Location:** Lines 588-596 (inside ticket form, after Ticket Note field)

**Added:**
```html
<!-- Customer Default Note Display -->
<div id="customer-default-note-container" class="hidden mb-4 p-3 bg-amber-50 border-2 border-amber-200 rounded-xl">
  <div class="flex items-start gap-2">
    <span class="text-amber-600">📌</span>
    <div>
      <p class="text-sm font-semibold text-amber-800">Customer Note (will appear on ticket):</p>
      <p id="customer-default-note-display" class="text-amber-900 mt-1"></p>
    </div>
  </div>
</div>
```

**Impact:**
- Creates a hidden yellow box that appears when customer with note is selected
- Styled with Tailwind CSS (amber colors, rounded, bordered)
- Starts hidden (`.hidden` class)
- Shows 📌 emoji for visual indicator

---

### Change 3B: Customer Change Handler Function

**Location:** Lines 2825-2873

**Modified Function:** `handleCustomerChange(e)`

**Key Addition (Lines 2842-2848):**
```javascript
// Show/hide default note
if (customer && customer.defaultNote && defaultNoteContainer && defaultNoteDisplay) {
  defaultNoteDisplay.textContent = customer.defaultNote;
  defaultNoteContainer.classList.remove('hidden');
} else if (defaultNoteContainer) {
  defaultNoteContainer.classList.add('hidden');
}
```

**Complete Context:**
```javascript
function handleCustomerChange(e) {
  const selectedOption = e.target.selectedOptions[0];
  const defaultNoteContainer = document.getElementById('customer-default-note-container');
  const defaultNoteDisplay = document.getElementById('customer-default-note-display');

  if (!selectedOption || !selectedOption.value) {
    // No customer selected - show all products, hide default note, clear freight
    populateProductDropdown();
    if (defaultNoteContainer) defaultNoteContainer.classList.add('hidden');
    clearFreightFields();
    return;
  }

  // Get the customer record to find default note and freight settings
  const customerId = selectedOption.getAttribute('data-airtableid');
  const customer = CUSTOMERS.find(c => (c.airtableId || c.id) === customerId);

  // Show/hide default note                              // ← KEY SECTION
  if (customer && customer.defaultNote && defaultNoteContainer && defaultNoteDisplay) {
    defaultNoteDisplay.textContent = customer.defaultNote;
    defaultNoteContainer.classList.remove('hidden');
  } else if (defaultNoteContainer) {
    defaultNoteContainer.classList.add('hidden');
  }

  // Auto-populate freight settings from customer profile
  applyCustomerFreightSettings(customer);

  // Filter product dropdown based on allowed products
  // ... (existing code)
}
```

**Impact:**
- Fires whenever customer dropdown changes
- Looks up selected customer in CUSTOMERS array
- If customer has `defaultNote`, shows yellow preview box
- If customer has no note, hides preview box
- Integrated with existing product filtering and freight logic

---

### Change 3C: Fetch Customer Default Note During Submission

**Location:** Lines 4882-4885

**Added:**
```javascript
// Get customer's default note
const customerId = customerSelect.selectedOptions[0]?.dataset.airtableid;
const customer = CUSTOMERS.find(c => (c.airtableId || c.id) === customerId);
const customerDefaultNote = customer?.defaultNote || '';
```

**Context (ticket form submit handler):**
```javascript
document.getElementById('ticket-form').addEventListener('submit', async function(e) {
  e.preventDefault();

  try {
    // Get selected options with their Airtable IDs
    const customerSelect = document.getElementById('ticket-customer');
    const carrierSelect = document.getElementById('ticket-carrier');
    const truckInput = document.getElementById('ticket-truck');
    const productSelect = document.getElementById('ticket-product');

    // Get customer's default note                       // ← ADDED
    const customerId = customerSelect.selectedOptions[0]?.dataset.airtableid;
    const customer = CUSTOMERS.find(c => (c.airtableId || c.id) === customerId);
    const customerDefaultNote = customer?.defaultNote || '';

    // ... calculate weights, pricing, etc.
```

**Impact:**
- Retrieves customer default note at moment of ticket creation
- Stores in `customerDefaultNote` variable for use in API request
- Uses optional chaining (`?.`) for safety
- Defaults to empty string if customer has no note

---

### Change 3D: Include Customer Note in API Request

**Location:** Line 4994 (inside ticketData object)

**Modified:**
```javascript
const ticketData = {
  customerId: customerSelect.selectedOptions[0]?.dataset.airtableid || customerSelect.value,
  carrierId: carrierSelect.selectedOptions[0]?.dataset.airtableid || carrierSelect.value,
  truck: truckInput.value.trim(),
  productId: productSelect.selectedOptions[0]?.dataset.airtableid || productSelect.value,
  gross: gross,
  tare: tare,
  po: document.getElementById('ticket-po').value || '',
  note: document.getElementById('ticket-note').value || '',
  customerNote: customerDefaultNote, // Customer's default note  // ← ADDED
  freightCost: freightCostTotal,
  freightCharge: freightChargeTotal,
  pumiceCharge: pumiceCharge,
  pricePerUnit: pricePerUnit,
  pricingMethod: customer?.pricingMethod || 'Per Yard'
};
```

**Impact:**
- Sends `customerNote` to backend API
- Backend (create-ticket.js) saves it to Airtable `Customer Note` field
- Separate from `note` (which is the Ticket Note field)

---

### Change 3E: Store Customer Note in Local Ticket Object

**Location:** Line 5033

**Added:**
```javascript
const newTicket = {
  id: result.id,
  airtableId: result.id,
  number: result.ticketNumber || (tickets.length > 0 ? Math.max(...tickets.map(t => t.number)) + 1 : 4744),
  customer: customerSelect.selectedOptions[0]?.text || '',
  customerId: ticketData.customerId,
  carrier: carrierSelect.selectedOptions[0]?.text || '',
  carrierId: ticketData.carrierId,
  truck: truckInput.value.trim(),
  product: productSelect.selectedOptions[0]?.text || '',
  productId: ticketData.productId,
  gross: ticketData.gross,
  tare: ticketData.tare,
  po: ticketData.po,
  note: ticketData.note,
  customerNote: ticketData.customerNote, // Customer's default note  // ← ADDED
  freightCost: ticketData.freightCost,
  freightCharge: ticketData.freightCharge,
  freightMargin: ticketData.freightCharge - ticketData.freightCost,
  date: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  printUrl: result.printUrl
};
```

**Impact:**
- Stores customer note in local `tickets` array
- Used for displaying ticket in table and reports
- Maintains consistency between frontend and backend data

---

### Change 3F: Hide Preview After Successful Submission

**Location:** Line 5076

**Added:**
```javascript
document.getElementById('new-ticket-number').textContent = newTicket.number;
document.getElementById('success-banner').classList.remove('hidden');

this.reset();
document.getElementById('calculations').classList.add('hidden');
document.getElementById('customer-default-note-container').classList.add('hidden'); // ← ADDED
window.scrollTo({ top: 0, behavior: 'smooth' });
```

**Impact:**
- Clears the yellow preview box after ticket is created
- Prevents note from persisting when creating next ticket
- Part of form reset workflow

---

## Not Included in This Package

### ticket-viewer.html

The ticket viewer already has code to display Customer Note (v2.1+), but it's not included in this minimal deployment package.

**Existing code in ticket-viewer.html (Lines 375-381):**
```javascript
// Handle customer note (shows if present)
const customerNoteContainer = document.getElementById(`${prefix}-customer-note-container`);
const customerNoteEl = document.getElementById(`${prefix}-customer-note`);
if (customerNote && customerNoteContainer && customerNoteEl) {
  customerNoteEl.textContent = customerNote;
  customerNoteContainer.style.display = 'block';
}
```

**If you need ticket-viewer.html:**
Request the complete v2.2 package or verify your current ticket-viewer.html includes the above code.

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA FLOW DIAGRAM                           │
└─────────────────────────────────────────────────────────────────┘

1. INITIAL LOAD
   ─────────────
   Airtable Customers Table (Default Note column)
     ↓
   GET /api/customers
     ↓
   customers.js (Line 86: fetch defaultNote)
     ↓
   Frontend CUSTOMERS array
     [{id: "rec123", name: "Granite", defaultNote: "Signature required"}]

2. CUSTOMER SELECTION
   ───────────────────
   User selects "Granite Construction" from dropdown
     ↓
   handleCustomerChange() fires (Lines 2825-2873)
     ↓
   Lookup customer in CUSTOMERS array
     ↓
   If customer.defaultNote exists:
     - Show yellow preview box (#customer-default-note-container)
     - Display note text (#customer-default-note-display)

3. TICKET CREATION
   ────────────────
   User clicks "Create Ticket"
     ↓
   Form submit handler (Lines 4882-4885)
     ↓
   Fetch customerDefaultNote from selected customer
     ↓
   Build ticketData object (Line 4994)
     {customerNote: "Signature required"}
     ↓
   POST /api/tickets/create
     ↓
   create-ticket.js (Lines 114-116)
     ↓
   Save to Airtable: Customer Note field
     ↓
   Return ticket ID

4. TICKET DISPLAY/PRINT
   ────────────────────
   User clicks "Print Ticket"
     ↓
   Open ticket-viewer.html?id=rec123
     ↓
   Fetch ticket from Airtable (includes Customer Note field)
     ↓
   Display Customer Note with 📌 icon (if present)
```

---

## Testing Hooks

For debugging, you can test each stage:

### Stage 1: API Returns Default Notes
```javascript
fetch('/api/customers').then(r=>r.json()).then(d=>console.log(d.customers[0].defaultNote))
```

### Stage 2: Preview Shows on Selection
```javascript
// Select customer in UI, then check:
document.getElementById('customer-default-note-display').textContent
document.getElementById('customer-default-note-container').classList.contains('hidden')
```

### Stage 3: Note Sent to Backend
```javascript
// After creating ticket, check network tab:
// POST /api/tickets/create
// Request payload should include: customerNote: "..."
```

### Stage 4: Note Saved in Airtable
```javascript
// Check Airtable Tickets table
// Should see value in "Customer Note" column
```

---

## Backward Compatibility

All changes are **backward compatible**:

- ✅ Works if Airtable field doesn't exist (saved in `optionalFields`)
- ✅ Works if customer has no default note (empty string)
- ✅ Works with existing tickets (no retroactive changes)
- ✅ Doesn't affect customers without default notes

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.1 | Jan 2026 | Ticket pricing, freight, truck text field |
| v2.2 | Feb 2026 | Customer default notes (this update) |

---

**Questions about implementation?** See DEPLOY.md for deployment instructions or TESTING.md for verification steps.
