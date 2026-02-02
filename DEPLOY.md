# v2.2 Customer Default Notes - Deployment Package

## 🎯 What This Fixes

**Issue Reported by Brent:**
> "We are still missing the default notes on the Granite Tickets. The Notes are in the customer profile but not printing on the tickets."

**Solution:**
This deployment package ensures that default notes from customer profiles automatically appear on their tickets.

---

## 📦 Package Contents

```
beaver-pumice-v2.2-customer-notes-deploy/
├── DEPLOY.md                           (this file)
├── TESTING.md                          (testing instructions)
├── index.html                          (main app - 300KB)
└── netlify/functions/
    ├── customers.js                    (fetches Default Note from Airtable)
    └── create-ticket.js                (saves Customer Note to tickets)
```

---

## ⚠️ PREREQUISITE: Airtable Field Setup

**CRITICAL:** Before deploying, verify this field exists in your Airtable **Tickets** table:

### Required Field:
- **Table:** Tickets
- **Field Name:** `Customer Note` (exact case-sensitive match)
- **Field Type:** Long Text

### How to Check:
1. Open Airtable base: `appZxvRMbFIHl63lH`
2. Go to **Tickets** table
3. Look for a column named "Customer Note"
4. If it doesn't exist, click **+** to add new field:
   - Field name: `Customer Note`
   - Field type: Long text

---

## 🚀 Deployment Steps

### Option A: Netlify UI (Recommended for Quick Deploy)

1. **Log in to Netlify**
   - Go to: https://app.netlify.com
   - Find your Beaver Pumice site

2. **Upload Files via Drag-and-Drop**
   - Click **Deploys** tab
   - Drag the entire `beaver-pumice-v2.2-customer-notes-deploy` folder onto the deploy dropzone
   - **OR** manually place files:
     - `index.html` → root directory
     - `netlify/functions/customers.js` → keep in netlify/functions/
     - `netlify/functions/create-ticket.js` → keep in netlify/functions/

3. **Wait for Build to Complete**
   - Netlify will process the deploy (30-60 seconds)
   - Green checkmark = success

### Option B: Git Deploy (If Using GitHub/Git)

1. **Copy Files to Your Git Repository**
   ```bash
   # From this deployment package directory
   cp index.html /path/to/your/beaver-pumice-repo/
   cp netlify/functions/*.js /path/to/your/beaver-pumice-repo/netlify/functions/
   ```

2. **Commit and Push**
   ```bash
   cd /path/to/your/beaver-pumice-repo
   git add index.html netlify/functions/customers.js netlify/functions/create-ticket.js
   git commit -m "v2.2: Add customer default notes to tickets

   - customers.js: Fetch Default Note from Airtable
   - create-ticket.js: Save Customer Note field to tickets
   - index.html: Show yellow preview box when customer selected

   Fixes: Granite customer notes now appear on printed tickets"
   git push
   ```

3. **Verify Netlify Auto-Deploy**
   - Check Netlify dashboard for automatic deployment
   - Wait for build to complete

---

## ✅ Post-Deployment Verification

### 1. Verify API Returns Default Notes

Open your site, press **F12** (Developer Console), paste this:

```javascript
fetch('/api/customers')
  .then(r => r.json())
  .then(d => {
    const withNotes = d.customers.filter(c => c.defaultNote);
    console.log(`✅ ${withNotes.length} customers have default notes:`);
    withNotes.forEach(c => console.log(`  • ${c.name}: "${c.defaultNote}"`));

    if (withNotes.length === 0) {
      console.warn('⚠️  No customers have default notes set in Airtable');
      console.log('👉 Add "Default Note" values to customer profiles in Airtable Customers table');
    }
  });
```

**Expected Output:**
```
✅ 3 customers have default notes:
  • Granite Construction: "Granite requires signature on delivery"
  • ABC Materials: "Call dispatch before delivery"
```

If you see `⚠️ 0 customers have default notes`, you need to:
1. Open Airtable → **Customers** table
2. Add text to the **Default Note** column for Granite customers
3. Re-run the test

---

### 2. Test the User Experience

1. **Open the App**
   - Go to your Netlify URL (e.g., `https://beaver-pumice.netlify.app`)

2. **Click "Create Ticket"**

3. **Select a Customer with a Default Note**
   - Choose a Granite customer from the dropdown

4. **Verify Yellow Preview Box Appears:**
   ```
   📌 Customer Note (will appear on ticket):
   Granite requires signature on delivery
   ```

5. **Fill Out the Rest of the Ticket:**
   - Hauling For: (any carrier)
   - Truck: (any truck ID)
   - Product: (any product)
   - Gross/Tare: (sample weights)

6. **Submit the Ticket**

7. **Print the Ticket**
   - Click the print button
   - **Verify** the Customer Note appears with a 📌 icon
   - **Verify** it's separate from the Ticket Note field

---

### 3. Test Different Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Select customer WITH default note | Yellow box shows note preview |
| Select customer WITHOUT default note | No yellow box appears |
| Create ticket for customer with note | Ticket prints with Customer Note (📌) |
| Create ticket for customer without note | Ticket prints normally (no Customer Note section) |
| Add Ticket Note separately | Both Customer Note and Ticket Note appear independently |

---

## 🔧 Troubleshooting

### Issue: "No customers have default notes"

**Cause:** Default Note column is empty in Airtable Customers table

**Fix:**
1. Open Airtable → Customers table
2. Find or create the **Default Note** column
3. Add notes for Granite customers
4. Reload the app

---

### Issue: Yellow preview doesn't appear

**Cause:** JavaScript error or customer object not loading

**Fix:**
1. Open browser console (F12)
2. Look for errors (red text)
3. Verify `/api/customers` returns data (run Test #1 above)
4. Hard refresh the page: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)

---

### Issue: Customer Note not saving to ticket

**Cause:** `Customer Note` field doesn't exist in Airtable Tickets table

**Fix:**
1. Open Airtable → **Tickets** table
2. Add field: **Customer Note** (Long Text)
3. Create a new test ticket
4. Check Airtable to verify the note was saved

---

### Issue: Note appears on screen but not on print

**Cause:** `ticket-viewer.html` might be outdated

**Solution:**
- The full v2.2 package includes `ticket-viewer.html`
- If needed, request the complete v2.2 package with all files

---

## 📋 Files Changed Summary

### 1. **customers.js** (Line 86)
```javascript
// ✅ NOW INCLUDED
defaultNote: record.fields['Default Note'] || '',
```

### 2. **create-ticket.js** (Lines 114-116)
```javascript
// ✅ NOW SAVES TO AIRTABLE
if (ticketData.customerNote) {
  optionalFields['Customer Note'] = sanitize(ticketData.customerNote);
}
```

### 3. **index.html** (Multiple Changes)

**Yellow Preview Box (Lines 588-596):**
```html
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

**Handler Function (Lines 2825-2873):**
```javascript
function handleCustomerChange(e) {
  // Gets customer object
  const customer = CUSTOMERS.find(c => (c.airtableId || c.id) === customerId);

  // Shows/hides preview
  if (customer && customer.defaultNote) {
    defaultNoteDisplay.textContent = customer.defaultNote;
    defaultNoteContainer.classList.remove('hidden');
  }
}
```

**Ticket Submission (Lines 4885, 4994):**
```javascript
const customerDefaultNote = customer?.defaultNote || '';
// ...
customerNote: customerDefaultNote, // Sent to API
```

---

## 📞 Support

If you encounter issues:

1. **Check Netlify Function Logs:**
   - Netlify Dashboard → Functions → View logs
   - Look for errors from `create-ticket` or `customers`

2. **Check Browser Console:**
   - Press F12
   - Look for red error messages

3. **Verify Airtable:**
   - Check that `Customer Note` field exists in Tickets table
   - Check that customers have default notes filled in

---

## 🎉 What's New in v2.2

- ✅ Customer default notes automatically populate on tickets
- ✅ Yellow preview box shows note before ticket creation
- ✅ Customer Note prints on ticket with 📌 icon
- ✅ Customer Note is separate from Ticket Note field
- ✅ Works for any customer with a default note (not just Granite)

---

**Deploy Date:** February 2, 2026
**Version:** v2.2
**Fix:** Customer Default Notes on Tickets
**Reported By:** Brent
**Status:** ✅ Ready to Deploy
