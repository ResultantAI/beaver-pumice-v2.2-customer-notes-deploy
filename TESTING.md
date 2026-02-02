# Testing Guide - Customer Default Notes Feature

## 🧪 Quick Test Suite

Run these tests after deploying to verify everything works correctly.

---

## Test 1: API Returns Customer Default Notes

**Goal:** Verify the `/api/customers` endpoint returns default notes

**Steps:**
1. Open your Beaver Pumice site
2. Press **F12** to open Developer Console
3. Paste this code and press Enter:

```javascript
// ===== TEST 1: Verify API Returns Default Notes =====
console.log('🧪 TEST 1: Checking /api/customers endpoint...\n');

fetch('/api/customers')
  .then(r => r.json())
  .then(d => {
    console.log(`📊 Total customers: ${d.customers.length}`);

    const withNotes = d.customers.filter(c => c.defaultNote);
    const withoutNotes = d.customers.filter(c => !c.defaultNote);

    console.log(`✅ Customers WITH default notes: ${withNotes.length}`);
    console.log(`⚪ Customers WITHOUT default notes: ${withoutNotes.length}\n`);

    if (withNotes.length > 0) {
      console.log('📌 Default Notes Found:');
      withNotes.forEach(c => {
        console.log(`  • ${c.name}:`);
        console.log(`    "${c.defaultNote}"`);
      });
      console.log('\n✅ TEST 1 PASSED\n');
    } else {
      console.warn('⚠️  TEST 1 WARNING: No customers have default notes set');
      console.log('👉 Action Required: Add default notes in Airtable Customers table\n');
    }
  })
  .catch(err => {
    console.error('❌ TEST 1 FAILED:', err);
  });
```

**Expected Output:**
```
🧪 TEST 1: Checking /api/customers endpoint...

📊 Total customers: 25
✅ Customers WITH default notes: 3
⚪ Customers WITHOUT default notes: 22

📌 Default Notes Found:
  • Granite Construction:
    "Granite requires signature on delivery"
  • ABC Materials:
    "Call dispatch before delivery"
  • XYZ Corp:
    "Weekend deliveries only"

✅ TEST 1 PASSED
```

**If Test Fails:**
- Check Airtable → Customers table → Default Note column
- Make sure at least one customer has a default note
- Redeploy if customers.js wasn't updated

---

## Test 2: Verify DOM Elements Exist

**Goal:** Check that HTML elements for preview box are in place

**Steps:**
1. In the same console, paste this code:

```javascript
// ===== TEST 2: Check HTML Elements =====
console.log('🧪 TEST 2: Checking DOM elements...\n');

const tests = [
  {
    name: 'Customer dropdown',
    id: 'ticket-customer',
    required: true
  },
  {
    name: 'Preview container',
    id: 'customer-default-note-container',
    required: true
  },
  {
    name: 'Preview display element',
    id: 'customer-default-note-display',
    required: true
  }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  const element = document.getElementById(test.id);
  if (element) {
    console.log(`✅ ${test.name} found (#${test.id})`);
    passed++;
  } else {
    console.error(`❌ ${test.name} NOT FOUND (#${test.id})`);
    failed++;
  }
});

// Check for handleCustomerChange function
if (typeof handleCustomerChange === 'function') {
  console.log('✅ handleCustomerChange() function exists');
  passed++;
} else {
  console.error('❌ handleCustomerChange() function NOT FOUND');
  failed++;
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ TEST 2 PASSED\n');
} else {
  console.error('❌ TEST 2 FAILED - Check that index.html was deployed correctly\n');
}
```

**Expected Output:**
```
🧪 TEST 2: Checking DOM elements...

✅ Customer dropdown found (#ticket-customer)
✅ Preview container found (#customer-default-note-container)
✅ Preview display element found (#customer-default-note-display)
✅ handleCustomerChange() function exists

📊 Results: 4 passed, 0 failed
✅ TEST 2 PASSED
```

**If Test Fails:**
- Verify index.html was deployed correctly
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Check that you're looking at the latest deploy (not cached version)

---

## Test 3: Simulate Customer Selection

**Goal:** Test that selecting a customer shows the preview box

**Steps:**
1. Paste this code in the console:

```javascript
// ===== TEST 3: Simulate Customer Selection =====
console.log('🧪 TEST 3: Testing customer selection...\n');

// Click "Create Ticket" to open the form (if not already open)
const createTicketBtn = Array.from(document.querySelectorAll('button')).find(btn =>
  btn.textContent.includes('Create Ticket') || btn.textContent.includes('New Ticket')
);

if (createTicketBtn) {
  createTicketBtn.click();
  console.log('📝 Opened ticket form');

  setTimeout(() => {
    const customerSelect = document.getElementById('ticket-customer');
    const previewContainer = document.getElementById('customer-default-note-container');
    const previewDisplay = document.getElementById('customer-default-note-display');

    if (!customerSelect) {
      console.error('❌ TEST 3 FAILED: Customer dropdown not found');
      return;
    }

    // Find a customer with a default note
    fetch('/api/customers')
      .then(r => r.json())
      .then(d => {
        const customerWithNote = d.customers.find(c => c.defaultNote);

        if (!customerWithNote) {
          console.warn('⚠️  TEST 3 SKIPPED: No customers have default notes');
          console.log('👉 Add default notes in Airtable to test this feature\n');
          return;
        }

        console.log(`🎯 Testing with customer: ${customerWithNote.name}`);
        console.log(`📌 Expected note: "${customerWithNote.defaultNote}"\n`);

        // Select the customer
        const option = Array.from(customerSelect.options).find(opt =>
          opt.text === customerWithNote.name
        );

        if (!option) {
          console.error('❌ TEST 3 FAILED: Customer not found in dropdown');
          return;
        }

        customerSelect.value = option.value;
        customerSelect.dispatchEvent(new Event('change'));

        // Wait for UI to update
        setTimeout(() => {
          const isVisible = !previewContainer.classList.contains('hidden');
          const displayText = previewDisplay.textContent;

          console.log('Preview box visible:', isVisible);
          console.log('Preview text:', `"${displayText}"`);

          if (isVisible && displayText === customerWithNote.defaultNote) {
            console.log('\n✅ TEST 3 PASSED - Preview box shows correct note\n');
          } else if (!isVisible) {
            console.error('❌ TEST 3 FAILED: Preview box did not appear');
            console.log('Check that handleCustomerChange() is attached to dropdown\n');
          } else {
            console.error('❌ TEST 3 FAILED: Preview shows wrong text');
            console.log(`Expected: "${customerWithNote.defaultNote}"`);
            console.log(`Got: "${displayText}"\n`);
          }
        }, 500);
      });
  }, 500);
} else {
  console.warn('⚠️  Could not find "Create Ticket" button');
  console.log('👉 Manually click "Create Ticket" and run TEST 3 again\n');
}
```

**Expected Output:**
```
🧪 TEST 3: Testing customer selection...

📝 Opened ticket form
🎯 Testing with customer: Granite Construction
📌 Expected note: "Granite requires signature on delivery"

Preview box visible: true
Preview text: "Granite requires signature on delivery"

✅ TEST 3 PASSED - Preview box shows correct note
```

**If Test Fails:**
- Check browser console for JavaScript errors
- Verify customer has a default note in Airtable
- Check that handleCustomerChange is firing (add breakpoint)

---

## Manual Test 4: End-to-End Ticket Creation

**Goal:** Create a real ticket and verify the note appears on print

**Steps:**

### 4A. Create Test Ticket

1. **Open the app** in your browser
2. Click **"Create Ticket"**
3. Fill out the form:
   - **Customer:** Select "Granite Construction" (or another customer with a default note)
   - **Verify:** Yellow preview box appears showing the note
   - **Hauling For:** Select any carrier
   - **Truck:** Enter "TEST-01"
   - **Product:** Select any product
   - **Gross Weight:** 50000
   - **Tare Weight:** 30000
   - **PO Number:** (leave blank)
   - **Ticket Note:** "This is a test ticket for v2.2"
4. Click **"Create Ticket"**
5. Wait for success message

### 4B. Verify Print View

1. Click the **"Print Ticket"** button
2. A new window/tab should open with the ticket
3. **Check for Customer Note section:**
   - Should appear above the Ticket Note
   - Should have a 📌 icon
   - Should display: "Granite requires signature on delivery"
4. **Check for Ticket Note section:**
   - Should appear below Customer Note
   - Should display: "This is a test ticket for v2.2"

### Expected Layout on Printed Ticket:

```
┌─────────────────────────────────────┐
│  BEAVER PUMICE LLC                  │
│  Ticket #4801                       │
├─────────────────────────────────────┤
│  Customer: Granite Construction     │
│  Hauling For: ABC Trucking          │
│  Truck: TEST-01                     │
│  Product: Coarse Pumice             │
├─────────────────────────────────────┤
│  📌 Customer Note:                  │
│  Granite requires signature on      │
│  delivery                           │
│                                     │
│  Ticket Note:                       │
│  This is a test ticket for v2.2     │
└─────────────────────────────────────┘
```

**Pass Criteria:**
- ✅ Customer Note appears with 📌 icon
- ✅ Customer Note shows correct text from customer profile
- ✅ Ticket Note appears separately below
- ✅ Both notes are readable and formatted correctly

**If Test Fails:**
- Check Airtable Tickets table for the new ticket
- Verify "Customer Note" field has data in Airtable
- Check ticket-viewer.html is included in deployment
- Request full v2.2 package if ticket-viewer.html is missing

---

## Manual Test 5: Customer Without Default Note

**Goal:** Verify app works normally for customers without notes

**Steps:**

1. Click **"Create Ticket"**
2. **Customer:** Select a customer WITHOUT a default note (e.g., "Regular Customer Inc")
3. **Verify:** No yellow preview box appears
4. Fill out the rest normally
5. Submit ticket
6. Print ticket
7. **Verify:** No Customer Note section appears (only Ticket Note)

**Pass Criteria:**
- ✅ No yellow preview box for customers without notes
- ✅ Ticket creation works normally
- ✅ Printed ticket doesn't show empty Customer Note section

---

## Comprehensive Test Results Template

Copy this and fill out after running all tests:

```
═══════════════════════════════════════════
  BEAVER PUMICE v2.2 - TEST RESULTS
═══════════════════════════════════════════

Deploy Date: ______________
Tester: ______________
Environment: ______________

─────────────────────────────────────────
TEST 1: API Returns Customer Default Notes
─────────────────────────────────────────
Status: [ ] PASS  [ ] FAIL  [ ] SKIP
Notes: _________________________________

─────────────────────────────────────────
TEST 2: Verify DOM Elements Exist
─────────────────────────────────────────
Status: [ ] PASS  [ ] FAIL  [ ] SKIP
Notes: _________________________________

─────────────────────────────────────────
TEST 3: Simulate Customer Selection
─────────────────────────────────────────
Status: [ ] PASS  [ ] FAIL  [ ] SKIP
Notes: _________________________________

─────────────────────────────────────────
TEST 4: End-to-End Ticket Creation
─────────────────────────────────────────
Status: [ ] PASS  [ ] FAIL  [ ] SKIP
Ticket Number Created: ______________
Customer Note Visible on Print: [ ] YES  [ ] NO
Notes: _________________________________

─────────────────────────────────────────
TEST 5: Customer Without Default Note
─────────────────────────────────────────
Status: [ ] PASS  [ ] FAIL  [ ] SKIP
Preview Box Correctly Hidden: [ ] YES  [ ] NO
Notes: _________________________________

─────────────────────────────────────────
OVERALL RESULT
─────────────────────────────────────────
All Tests Passing: [ ] YES  [ ] NO

Issues Found:
_________________________________________
_________________________________________

Action Items:
_________________________________________
_________________________________________

═══════════════════════════════════════════
```

---

## Quick Smoke Test (30 seconds)

If you're short on time, run this quick test:

1. Open app
2. Click "Create Ticket"
3. Select "Granite Construction"
4. **Does yellow box appear?** → YES = probably working
5. Create dummy ticket
6. Print it
7. **Does 📌 Customer Note appear?** → YES = feature working!

---

## Troubleshooting Test Failures

### All Tests Fail
- **Likely Cause:** Deployment didn't complete or files not updated
- **Fix:** Verify files were uploaded to Netlify, check deploy logs

### Test 1 Fails
- **Likely Cause:** customers.js not deployed or Airtable field missing
- **Fix:** Redeploy customers.js, check Airtable schema

### Test 2 Fails
- **Likely Cause:** index.html not deployed or cached version loading
- **Fix:** Hard refresh (Cmd+Shift+R), clear cache, redeploy index.html

### Test 3 Fails
- **Likely Cause:** JavaScript event listener not attached
- **Fix:** Check console for errors, verify handleCustomerChange exists

### Test 4 Fails (API works but print doesn't show note)
- **Likely Cause:** ticket-viewer.html is outdated
- **Fix:** Request complete v2.2 package with ticket-viewer.html

---

**Questions?** Check DEPLOY.md for troubleshooting or contact support.
