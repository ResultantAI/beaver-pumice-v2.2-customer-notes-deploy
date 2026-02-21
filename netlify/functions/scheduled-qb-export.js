// netlify/functions/scheduled-qb-export.js
// v74 - COMPREHENSIVE FIX: Proper pricing from customers, QB codes from products
// Fixed issues: decimal places, customer pricing, QB Item Code mapping

const { Resend } = require('resend');

exports.config = {
  schedule: "0 7 * * *"  // Every day at 07:00 UTC (11 PM Pacific)
};

exports.handler = async (event, context) => {
  console.log('=== SCHEDULED QB EXPORT v74 STARTED ===');
  console.log('Time:', new Date().toISOString());
  
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  const TO_EMAIL = 'accounting@beaverpumice.com';
  const CC_EMAIL = 'lucas@beaverpumice.com';
  const FROM_EMAIL = process.env.FROM_EMAIL || 'tickets@beaverpumice.com';

  if (!AIRTABLE_TOKEN || !RESEND_API_KEY) {
    console.error('Missing configuration');
    return { statusCode: 500, body: 'Missing configuration' };
  }

  const resend = new Resend(RESEND_API_KEY);

  try {
    // Fetch all needed data
    const pendingTickets = await fetchPendingTickets(AIRTABLE_TOKEN, BASE_ID);
    
    if (pendingTickets.length === 0) {
      console.log('No pending tickets to export');
      return { statusCode: 200, body: 'No pending tickets' };
    }
    
    console.log(`Found ${pendingTickets.length} tickets to export`);

    // v74: Fetch customers WITH pricing info
    const customerIds = [...new Set(pendingTickets.map(t => t.customerId).filter(Boolean))];
    const customers = await fetchCustomersWithPricing(AIRTABLE_TOKEN, BASE_ID, customerIds);
    
    // v74: Fetch products with QB Item Codes
    const products = await fetchProducts(AIRTABLE_TOKEN, BASE_ID);
    
    const startingInvoiceNum = await getNextInvoiceNumber(AIRTABLE_TOKEN, BASE_ID);

    const today = new Date();
    const invoiceDate = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
    
    // v74: Pass products to generateIIF for QB code lookup
    const { iifContent, invoiceCount, nextInvoiceNum } = generateIIF(pendingTickets, customers, products, invoiceDate, startingInvoiceNum);

    const dateStr = today.toISOString().split('T')[0];
    await resend.emails.send({
      from: `Beaver Pumice <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      cc: CC_EMAIL,
      subject: `Beaver Pumice Invoices - ${dateStr} - ${pendingTickets.length} tickets`,
      html: generateEmailBody(pendingTickets, invoiceCount, dateStr),
      attachments: [{ filename: `beaver_pumice_invoices_${dateStr}.iif`, content: Buffer.from(iifContent).toString('base64'), type: 'text/plain' }]
    });

    await markTicketsExported(AIRTABLE_TOKEN, BASE_ID, pendingTickets.map(t => t.id));
    await updateInvoiceNumber(AIRTABLE_TOKEN, BASE_ID, nextInvoiceNum);

    console.log(`Exported ${pendingTickets.length} tickets in ${invoiceCount} invoices`);
    return { statusCode: 200, body: JSON.stringify({ success: true, ticketsExported: pendingTickets.length, invoicesGenerated: invoiceCount }) };

  } catch (error) {
    console.error('Export failed:', error);
    try {
      await resend.emails.send({
        from: `Beaver Pumice System <${FROM_EMAIL}>`,
        to: 'lucas@beaverpumice.com',
        subject: '⚠️ QuickBooks Auto-Export Failed',
        html: `<h2>QuickBooks Export Error</h2><p>Failed at ${new Date().toISOString()}</p><p><strong>Error:</strong> ${error.message}</p>`
      });
    } catch (e) { console.error('Failed to send error notification'); }
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// ==================== FETCH PENDING TICKETS ====================
async function fetchPendingTickets(token, baseId) {
  const filterFormula = encodeURIComponent(`AND({Status}="Closed", OR({QB Exported}=FALSE(), {QB Exported}=BLANK()))`);
  let allRecords = [], offset = null;
  
  do {
    const url = `https://api.airtable.com/v0/${baseId}/Tickets?filterByFormula=${filterFormula}&sort[0][field]=Ticket%20Number&sort[0][direction]=asc${offset ? `&offset=${offset}` : ''}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) throw new Error('Airtable error fetching tickets');
    const data = await response.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);
  
  return allRecords.map(record => {
    const f = record.fields;
    
    // v75: Read lookup fields from ticket (these come from Customers table via lookup)
    // NOTE: Airtable lookup fields return ARRAYS, so extract first element
    const rawMethod = f['Customer Pricing Method'] || f['Customer Pricing...'] || f['Pricing Method'] || '';
    const customerPricingMethod = Array.isArray(rawMethod) ? (rawMethod[0] || '') : (rawMethod || '');
    const rawRate = f['Customer Rate'];
    const customerRate = parseFloat(Array.isArray(rawRate) ? rawRate[0] : rawRate) || null;
    
    // v76: Freight Rate lookup (for calculating freight charge)
    const rawFreightRate = f['Freight Rate'];
    const freightRate = parseFloat(String(Array.isArray(rawFreightRate) ? rawFreightRate[0] : rawFreightRate || '').replace(/[$,]/g, '')) || null;
    
    // v76: Freight Charge - handle currency format ($123.45)
    const rawFreightCharge = f['Freight Charge'];
    const freightCharge = parseFloat(String(rawFreightCharge || '').replace(/[$,]/g, '')) || 0;
    
    // v74: Read Airtable's calculated fields for validation
    const airtableSubtotal = parseFloat(f['Subtotal']) || parseFloat(f['Pumice Charge']) || null;
    const airtableBillableQty = parseFloat(f['Billable Qty'] || f['Billable Quantity']) || null;
    const airtableTotal = parseFloat(f['Ticket Total'] || f['Total Charge']) || null;
    
    console.log(`Ticket ${f['Ticket Number']}: subtotal=${airtableSubtotal}, rate=${customerRate}, method=${customerPricingMethod}, freightRate=${freightRate}, freightCharge=${freightCharge}`);
    
    // v74: QB Item Code - prefer lookup field on ticket (most reliable)
    const qbItemCodeFromTicket = f['QB Item Code (from Product)']?.[0] || f['QB Item Code (from Product)'] || f['QB Item Code'] || null;
    
    return {
      id: record.id,
      number: f['Ticket Number'],
      customerId: f['Customer']?.[0],
      customerName: f['Customer Name']?.[0] || 'Unknown',
      productId: f['Product']?.[0],
      productName: f['Product Name']?.[0] || 'Pumice',
      carrierName: f['Hauling For Name']?.[0] || '',
      truckText: f['Truck Text'] || f['Truck Name']?.[0] || '',
      netTons: parseFloat(f['Net Tons']) || 0,
      netYards: parseFloat(f['Net Yards']) || 0,
      freightCharge: freightCharge,  // v76: Parsed from Airtable
      freightRate: freightRate,      // v76: For calculating if freightCharge is 0
      // v74: Lookup fields from ticket (snapshot of customer pricing)
      ticketPricingMethod: customerPricingMethod,
      ticketRate: customerRate,
      // v74: QB Item Code from ticket lookup (PRIMARY SOURCE)
      qbItemCode: qbItemCodeFromTicket,
      // v74: Airtable's pre-calculated values (for validation)
      airtableSubtotal: airtableSubtotal,
      airtableBillableQty: airtableBillableQty,
      airtableTotal: airtableTotal
    };
  });
}

// ==================== FETCH CUSTOMERS WITH PRICING (v74 FIX) ====================
async function fetchCustomersWithPricing(token, baseId, customerIds) {
  const customers = {};
  
  for (const id of customerIds) {
    try {
      const response = await fetch(
        `https://api.airtable.com/v0/${baseId}/Customers/${id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      
      if (response.ok) {
        const record = await response.json();
        const f = record.fields;
        
        // v74: Get ALL pricing fields from customer
        // Check multiple possible field names for maximum compatibility
        const priceTon = parseFloat(String(f['Price Ton'] || f['Price Per Ton'] || '').replace(/[$,]/g, '')) || null;
        const priceYard = parseFloat(String(f['Price Yard'] || f['Price Per Yard'] || '').replace(/[$,]/g, '')) || null;
        const customerRate = parseFloat(String(f['Customer Rate'] || f['Rate'] || '').replace(/[$,]/g, '')) || null;
        const pricingMethod = f['Pricing Method'] || f['Customer Pricing Method'] || '';
        
        console.log(`Customer "${f['Customer Name']}": priceTon=${priceTon}, priceYard=${priceYard}, customerRate=${customerRate}, method="${pricingMethod}"`);
        
        customers[id] = {
          name: f['Customer Name'] || 'Unknown',
          qbName: f['QB Customer Name'] || f['Customer Name'] || 'Unknown',
          address1: f['Bill To Address'] || f['Address1'] || '',
          city: f['Bill To City'] || f['City'] || '',
          state: f['Bill To State'] || f['State'] || '',
          zip: f['Bill To Zip'] || f['Zip'] || '',
          // v74: Pricing fields - with Customer Rate as universal fallback
          priceTon: priceTon,
          priceYard: priceYard,
          customerRate: customerRate,  // Universal rate field
          pricingMethod: pricingMethod,
          freightRate: parseFloat(String(f['Freight Rate'] || '').replace(/[$,]/g, '')) || null,
          freightMethod: f['Freight Method'] || ''
        };
      }
    } catch (err) {
      console.error(`Failed to fetch customer ${id}:`, err.message);
    }
  }
  
  return customers;
}

// ==================== FETCH PRODUCTS WITH QB CODES (v74 FIX) ====================
async function fetchProducts(token, baseId) {
  const products = { byId: {}, byName: {} };
  
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Products`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      
      for (const record of data.records || []) {
        const name = record.fields['Product Name'] || '';
        const qbCode = record.fields['QB Item Code'] || null;
        
        console.log(`Product "${name}" -> QB Code: "${qbCode}"`);
        
        const product = {
          id: record.id,
          name: name,
          qbItemCode: qbCode
        };
        
        products.byId[record.id] = product;
        if (name) {
          products.byName[name.toLowerCase().trim()] = product;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching products:', err.message);
  }
  
  return products;
}

// ==================== GET QB ITEM CODE (v74 - WITH FALLBACKS) ====================
function getQBItemCode(productName, productId, products, ticketQBCode) {
  // Priority 1: Ticket's lookup field (most reliable - directly from Airtable)
  if (ticketQBCode && /^P\d{3}$/.test(ticketQBCode)) {
    console.log(`  QB Code from ticket lookup: "${productName}" -> "${ticketQBCode}"`);
    return ticketQBCode;
  }
  
  // Priority 2: Product ID lookup from Products table
  if (productId && products.byId[productId]?.qbItemCode) {
    const code = products.byId[productId].qbItemCode;
    console.log(`  QB Code from product ID: "${productName}" -> "${code}"`);
    return code;
  }
  
  // Priority 3: Product name lookup
  if (productName) {
    const normalized = productName.toLowerCase().trim();
    if (products.byName[normalized]?.qbItemCode) {
      const code = products.byName[normalized].qbItemCode;
      console.log(`  QB Code from product name: "${productName}" -> "${code}"`);
      return code;
    }
  }
  
  // Priority 4: Fallback mappings
  const fallbacks = {
    '3/8 x 1/8': 'P001',
    '3/4 x 3/8': 'P002',
    '3/8 x minus': 'P003', '3/8 x MINUS': 'P003', '3/8 minus': 'P003', '3/8 MINUS': 'P003',
    'birds eye': 'P004', '1/8 #8': 'P004',
    '1 x 3/8': 'P005', '1x3/8': 'P005',
    '3/8 x 1/4': 'P009',
    '3/8 x 1/16': 'P013', '3/8x1/16': 'P013',
    '1/4 minus': 'P014', '1/4 x minus': 'P014', '1/4 MINUS': 'P014'
  };
  
  const searchName = (productName || '').toLowerCase().trim();
  
  // Exact match
  for (const [key, code] of Object.entries(fallbacks)) {
    if (searchName === key.toLowerCase()) {
      console.log(`  QB Code FALLBACK exact: "${productName}" -> "${code}"`);
      return code;
    }
  }
  
  // Contains match
  for (const [key, code] of Object.entries(fallbacks)) {
    if (searchName.includes(key.toLowerCase())) {
      console.log(`  QB Code FALLBACK contains: "${productName}" -> "${code}"`);
      return code;
    }
  }
  
  console.log(`  QB Code WARNING: No mapping for "${productName}"`);
  return productName;  // Will cause QB error
}

// ==================== GENERATE IIF (v74 - FIXED) ====================
function generateIIF(tickets, customers, products, invoiceDate, startingInvoiceNum) {
  const lines = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tADDR1\tADDR2\tADDR3\tADDR4\tADDR5',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tQNTY\tPRICE\tINVITEM\tTAXABLE',
    '!ENDTRNS'
  ];
  
  let invoiceNum = startingInvoiceNum;
  
  // Group tickets by customer
  const ticketsByCustomer = {};
  for (const ticket of tickets) {
    const cid = ticket.customerId || 'unknown';
    if (!ticketsByCustomer[cid]) ticketsByCustomer[cid] = [];
    ticketsByCustomer[cid].push(ticket);
  }
  
  for (const [customerId, customerTickets] of Object.entries(ticketsByCustomer)) {
    const customer = customers[customerId] || {};
    const customerName = customer.qbName || customerTickets[0].customerName;
    
    console.log(`\n=== Processing ${customerTickets.length} tickets for "${customerName}" ===`);
    console.log(`  Customer pricing: method="${customer.pricingMethod}", priceTon=${customer.priceTon}, priceYard=${customer.priceYard}`);
    
    let totalAmount = 0;
    const splLines = [];
    
    for (const ticket of customerTickets) {
      // v74: PRIORITY for pricing data:
      // 1. Ticket's lookup fields (snapshot at ticket creation time) - MOST RELIABLE
      // 2. Customer table data (current values)
      // 3. Default ($13)
      
      let billByYard = false;
      let pricePerUnit = 13;  // Default
      let pricingSource = 'default';
      
      // First try: Use ticket's lookup fields (if available)
      if (ticket.ticketPricingMethod && ticket.ticketRate) {
        const method = ticket.ticketPricingMethod.toLowerCase();
        billByYard = method.includes('yard');
        pricePerUnit = ticket.ticketRate;
        pricingSource = 'ticket-lookup';
      }
      // Second try: Use customer table data
      else if (customer.pricingMethod || customer.priceTon || customer.priceYard || customer.customerRate) {
        const method = (customer.pricingMethod || '').toLowerCase();
        const effectiveTonRate = customer.priceTon || customer.customerRate || 13;
        const effectiveYardRate = customer.priceYard || customer.customerRate || 13;
        
        if (method.includes('yard')) {
          billByYard = true;
          pricePerUnit = effectiveYardRate;
        } else if (method.includes('ton')) {
          billByYard = false;
          pricePerUnit = effectiveTonRate;
        } else if (customer.priceYard && !customer.priceTon) {
          billByYard = true;
          pricePerUnit = customer.priceYard;
        } else if (customer.priceTon && !customer.priceYard) {
          billByYard = false;
          pricePerUnit = customer.priceTon;
        } else if (customer.customerRate) {
          billByYard = false;
          pricePerUnit = customer.customerRate;
        }
        pricingSource = 'customer-table';
      }
      
      // v74: Calculate quantity (2 decimals)
      const qty = billByYard 
        ? Math.round(ticket.netYards * 100) / 100
        : Math.round(ticket.netTons * 100) / 100;
      
      const amount = Math.round(qty * pricePerUnit * 100) / 100;
      totalAmount += amount;
      
      // v74: VALIDATION - Compare our calculation to Airtable's if available
      if (ticket.airtableSubtotal && Math.abs(amount - ticket.airtableSubtotal) > 0.02) {
        console.log(`⚠️ VALIDATION WARNING Ticket ${ticket.number}:`);
        console.log(`   Our calculation: $${amount} (${qty} ${billByYard ? 'yards' : 'tons'} × $${pricePerUnit})`);
        console.log(`   Airtable shows:  $${ticket.airtableSubtotal}`);
        console.log(`   Difference: $${Math.abs(amount - ticket.airtableSubtotal).toFixed(2)}`);
      }
      
      // v74: Get QB Item Code properly (ticket lookup is primary source)
      const qbItemCode = getQBItemCode(ticket.productName, ticket.productId, products, ticket.qbItemCode);
      
      const memo = `Ticket - ${ticket.number} / ${ticket.productName} / ${ticket.truckText || ticket.carrierName}`;
      
      console.log(`  Ticket ${ticket.number}: ${billByYard ? 'YARD' : 'TON'} @ $${pricePerUnit} (${pricingSource}), ${qty} = $${amount}, QB: ${qbItemCode}`);
      
      // v74: QNTY uses toFixed(2) not toFixed(4)
      splLines.push([
        'SPL', invoiceNum, 'INVOICE', invoiceDate, 'Sales', customerName,
        (-amount).toFixed(2),  // AMOUNT
        invoiceNum,
        memo,
        (-qty).toFixed(2),     // QNTY - v74: 2 decimals!
        pricePerUnit.toFixed(2),  // PRICE
        qbItemCode,            // INVITEM - v74: proper QB code!
        'N'
      ].join('\t'));
      
      // v76: Freight line - use Airtable's calculated value OR calculate from rate
      let freightAmount = ticket.freightCharge || 0;
      
      // If no freight charge but we have freight rate, calculate it
      if (freightAmount === 0 && ticket.freightRate && ticket.freightRate > 0) {
        // Use same qty as product (tons or yards based on billing method)
        freightAmount = Math.round(qty * ticket.freightRate * 100) / 100;
        console.log(`  Freight calculated: ${qty} × $${ticket.freightRate} = $${freightAmount}`);
      }
      
      if (freightAmount > 0) {
        totalAmount += freightAmount;
        splLines.push([
          'SPL', invoiceNum, 'INVOICE', invoiceDate, 'Sales', customerName,
          (-freightAmount).toFixed(2),
          invoiceNum,
          `Freight - Ticket ${ticket.number}`,
          `-${qty.toFixed(2)}`,  // v76: Use same qty as product
          ticket.freightRate ? ticket.freightRate.toFixed(2) : freightAmount.toFixed(2),
          'Freight',
          'N'
        ].join('\t'));
        console.log(`  Freight added: $${freightAmount}`);
      }
    }
    
    // Invoice header
    const addr4 = [customer.city, customer.state, customer.zip].filter(Boolean).join(', ');
    lines.push([
      'TRNS', invoiceNum, 'INVOICE', invoiceDate, 'Accounts Receivable', customerName,
      totalAmount.toFixed(2),
      invoiceNum,
      `${customerTickets.length} ticket(s)`,
      customerName,
      customer.address1 || '',
      '',
      addr4,
      ''
    ].join('\t'));
    
    lines.push(...splLines);
    lines.push('ENDTRNS');
    invoiceNum++;
  }
  
  return {
    iifContent: lines.join('\r\n'),
    invoiceCount: invoiceNum - startingInvoiceNum,
    nextInvoiceNum: invoiceNum - 1
  };
}

// ==================== HELPER FUNCTIONS ====================
async function getNextInvoiceNumber(token, baseId) {
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Settings?filterByFormula=${encodeURIComponent(`{Setting Name}="Last Invoice Number"`)}&maxRecords=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.records.length > 0) {
        return (parseInt(data.records[0].fields['Setting Value']) || 1000) + 1;
      }
    }
  } catch (err) {}
  return 10000;
}

async function updateInvoiceNumber(token, baseId, newNumber) {
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Settings?filterByFormula=${encodeURIComponent(`{Setting Name}="Last Invoice Number"`)}&maxRecords=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.records.length > 0) {
        await fetch(`https://api.airtable.com/v0/${baseId}/Settings/${data.records[0].id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { 'Setting Value': newNumber.toString() } })
        });
      }
    }
  } catch (err) {}
}

async function markTicketsExported(token, baseId, ticketIds) {
  const today = new Date();
  const exportDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  for (let i = 0; i < ticketIds.length; i += 10) {
    const batch = ticketIds.slice(i, i + 10);
    try {
      await fetch(`https://api.airtable.com/v0/${baseId}/Tickets`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch.map(id => ({ id, fields: { 'QB Exported': true, 'QB Export Date': exportDate } })) })
      });
    } catch (err) {
      console.error('Failed to mark tickets exported:', err.message);
    }
  }
}

function generateEmailBody(tickets, invoiceCount, dateStr) {
  const byCustomer = {};
  let totalTons = 0, totalYards = 0;
  
  for (const t of tickets) {
    const name = t.customerName;
    if (!byCustomer[name]) byCustomer[name] = { count: 0, tons: 0, yards: 0 };
    byCustomer[name].count++;
    byCustomer[name].tons += t.netTons || 0;
    byCustomer[name].yards += t.netYards || 0;
    totalTons += t.netTons || 0;
    totalYards += t.netYards || 0;
  }
  
  const rows = Object.entries(byCustomer)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, d]) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${name}</td><td style="padding:8px;text-align:center">${d.count}</td><td style="padding:8px;text-align:right">${d.tons.toFixed(2)}</td><td style="padding:8px;text-align:right">${d.yards.toFixed(2)}</td></tr>`)
    .join('');
  
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif">
    <div style="background:#1e293b;color:white;padding:20px;text-align:center">
      <h1 style="margin:0">Beaver Pumice</h1>
      <p style="margin:5px 0 0;opacity:0.8">QuickBooks Export - ${dateStr}</p>
    </div>
    <div style="padding:20px">
      <div style="background:#f8fafc;padding:15px;border-radius:8px;margin:20px 0">
        <h2 style="margin-top:0">📋 Export Summary</h2>
        <p><strong>${tickets.length}</strong> tickets in <strong>${invoiceCount}</strong> invoice(s)</p>
        <p><strong>Total:</strong> ${totalTons.toFixed(2)} tons / ${totalYards.toFixed(2)} yards</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="background:#f1f5f9;padding:10px;text-align:left">Customer</th>
            <th style="background:#f1f5f9;padding:10px;text-align:center">Tickets</th>
            <th style="background:#f1f5f9;padding:10px;text-align:right">Tons</th>
            <th style="background:#f1f5f9;padding:10px;text-align:right">Yards</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <h3>📥 Import Instructions</h3>
      <ol>
        <li>Download the attached .iif file</li>
        <li>Open QuickBooks Desktop</li>
        <li>File → Utilities → Import → IIF Files</li>
        <li>Select the file and click Open</li>
      </ol>
    </div>
  </body></html>`;
}
