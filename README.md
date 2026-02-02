# Beaver Pumice v2.2 - Customer Default Notes

**Deployment Package**

---

## 📋 What's This?

This package fixes the issue where customer default notes weren't appearing on printed tickets.

**Reported by Brent:**
> "We are still missing the default notes on the Granite Tickets. The Notes are in the customer profile but not printing on the tickets."

**Status:** ✅ FIXED - Ready to deploy

---

## 🚀 Quick Start

### For Brent (or Non-Technical User):

1. **Download this entire folder**
2. **Send to your developer** or **upload to Netlify:**
   - Go to https://app.netlify.com
   - Find your Beaver Pumice site
   - Drag this folder onto the deploy dropzone
3. **Wait 60 seconds** for deployment to complete
4. **Test it:**
   - Open your site
   - Create a ticket for a Granite customer
   - Print it - the customer note should appear!

### For Developers:

1. **Read DEPLOY.md first** (detailed deployment instructions)
2. **Verify Airtable prerequisite:** `Customer Note` field exists in Tickets table
3. **Deploy 3 files:**
   - `index.html`
   - `netlify/functions/customers.js`
   - `netlify/functions/create-ticket.js`
4. **Run tests** from TESTING.md
5. **Verify** customer notes appear on printed tickets

---

## 📁 Files in This Package

```
beaver-pumice-v2.2-customer-notes-deploy/
│
├── README.md                     ← You are here
├── DEPLOY.md                     ← Step-by-step deployment guide
├── TESTING.md                    ← Test scripts and verification
├── CHANGES.md                    ← Technical details of code changes
│
├── index.html                    ← Main app (300KB)
└── netlify/functions/
    ├── customers.js              ← Fetches default notes from Airtable
    └── create-ticket.js          ← Saves customer notes to tickets
```

---

## ✨ What Changed

### User Experience:

**BEFORE:**
1. Customer has default note in profile
2. Create ticket → note doesn't appear
3. Have to manually type it every time

**AFTER:**
1. Customer has default note in profile
2. Select customer → Yellow preview box shows the note
3. Create ticket → note automatically included
4. Print ticket → note appears with 📌 icon

### Screenshots:

**Preview Box When Selecting Customer:**
```
┌─────────────────────────────────────────┐
│ 📌 Customer Note (will appear on ticket)│
│ Granite requires signature on delivery  │
└─────────────────────────────────────────┘
```

**Printed Ticket:**
```
┌─────────────────────────────────────────┐
│ Customer: Granite Construction          │
│ Product: Coarse Pumice                  │
│ Net: 10.0 tons / 7.4 yards              │
├─────────────────────────────────────────┤
│ 📌 Customer Note:                       │
│ Granite requires signature on delivery  │
│                                         │
│ Ticket Note:                            │
│ Gate code: 1234                         │
└─────────────────────────────────────────┘
```

---

## ⚠️ Important: Before You Deploy

**You MUST have this field in Airtable:**

1. Open Airtable base `appZxvRMbFIHl63lH`
2. Go to **Tickets** table
3. Look for column: **Customer Note**
4. If it doesn't exist:
   - Click **+** to add field
   - Name: `Customer Note`
   - Type: Long text

**Without this field, notes won't save!**

---

## 🧪 How to Test

### Quick Test (30 seconds):

1. Open your Beaver Pumice site
2. Click "Create Ticket"
3. Select "Granite Construction" from customer dropdown
4. **Does a yellow box appear with the customer note?** → YES = working!
5. Create the ticket
6. Print it
7. **Does the note appear on the ticket?** → YES = complete!

### Full Test Suite:

See **TESTING.md** for comprehensive test scripts.

---

## 📚 Documentation

| File | Purpose |
|------|---------|
| **DEPLOY.md** | Full deployment instructions with troubleshooting |
| **TESTING.md** | Browser console tests + manual test procedures |
| **CHANGES.md** | Technical implementation details |
| **README.md** | This overview document |

---

## 🐛 Troubleshooting

### "Yellow box doesn't appear when I select a customer"

**Cause:** Customer doesn't have a default note in Airtable

**Fix:**
1. Open Airtable → **Customers** table
2. Find the **Default Note** column
3. Add notes for Granite customers (or any customer you want)
4. Reload the app and try again

---

### "Yellow box appears but note doesn't print on ticket"

**Cause:** `Customer Note` field doesn't exist in Airtable **Tickets** table

**Fix:**
1. Open Airtable → **Tickets** table
2. Add field: **Customer Note** (Long text)
3. Create a new test ticket
4. Check Airtable to verify the note was saved

---

### "Nothing changed after deployment"

**Cause:** Browser cache or deployment didn't complete

**Fix:**
1. Check Netlify dashboard - is deploy complete?
2. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
3. Try incognito/private browsing mode
4. Check browser console for errors (F12)

---

## 💡 Tips

### Which customers should have default notes?

Add default notes for:
- ✅ Granite customers (signature required, special instructions)
- ✅ Customers with recurring special requests
- ✅ Customers with access codes/gate instructions
- ✅ Customers requiring specific documentation

**Don't need to add notes for:**
- ⚪ Regular customers with no special requirements
- ⚪ One-time deliveries

### What should default notes contain?

Good examples:
- "Requires signature on delivery"
- "Call dispatch before delivery: 555-1234"
- "Gate code: 1234"
- "Deliver to rear entrance only"
- "Weekend deliveries only - confirm 24h ahead"

Avoid:
- ❌ Customer pricing (use pricing fields instead)
- ❌ Contact info (use customer profile fields)
- ❌ Temporary one-off notes (use Ticket Note field for those)

---

## 🆘 Need Help?

1. **Check DEPLOY.md** for deployment issues
2. **Check TESTING.md** to verify everything works
3. **Check CHANGES.md** for technical details
4. **Check Netlify function logs** for backend errors
5. **Check browser console** (F12) for frontend errors

---

## ✅ Deployment Checklist

Use this checklist when deploying:

```
BEFORE DEPLOYMENT:
[ ] Verified Customer Note field exists in Airtable Tickets table
[ ] Added default notes to at least one customer for testing
[ ] Backed up current site (optional)

DURING DEPLOYMENT:
[ ] Uploaded index.html to root
[ ] Uploaded customers.js to netlify/functions/
[ ] Uploaded create-ticket.js to netlify/functions/
[ ] Waited for Netlify build to complete (green checkmark)

AFTER DEPLOYMENT:
[ ] Ran Test 1 (API returns default notes)
[ ] Ran Test 2 (DOM elements exist)
[ ] Ran Test 3 (Preview box appears)
[ ] Created test ticket
[ ] Verified note appears on printed ticket
[ ] Tested customer without default note (no preview)
[ ] All tests passing

CLEANUP:
[ ] Deleted test tickets from Airtable (if needed)
[ ] Informed Brent that fix is live
[ ] Updated internal docs with v2.2 version
```

---

## 📊 What's New in v2.2

- ✅ Customer default notes fetch from Airtable
- ✅ Yellow preview box shows note when customer selected
- ✅ Customer note automatically included on ticket creation
- ✅ Customer note prints on ticket with 📌 icon
- ✅ Customer Note separate from Ticket Note field
- ✅ Works with any customer that has a default note

---

## 🎉 Success Criteria

After deployment, you should see:

1. **When creating ticket:**
   - Select customer → yellow preview box appears
   - Preview shows the customer's default note
   - Can still add separate Ticket Note if needed

2. **When printing ticket:**
   - Customer Note section appears with 📌 icon
   - Shows the default note from customer profile
   - Ticket Note appears separately below

3. **For customers without default notes:**
   - No yellow preview box appears
   - Ticket works normally
   - No empty Customer Note section on print

---

**Deployment Date:** February 2, 2026
**Version:** v2.2
**Status:** Ready to Deploy
**Reported Issue:** Granite customer notes not appearing on tickets
**Resolution:** Customer default notes now automatically populate and print

---

**Questions?** Read DEPLOY.md for detailed instructions or contact your development team.
