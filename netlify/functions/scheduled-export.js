// scheduled-export.js - Runs at 11 PM Pacific daily
// Exports closed tickets to QuickBooks and emails to accounting

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'tickets@beaverpumice.com';

exports.handler = async (event) => {
  console.log('Scheduled export started at:', new Date().toISOString());
  
  try {
    // 1. Find closed tickets that haven't been exported
    const tickets = await getUnexportedClosedTickets();
    
    if (tickets.length === 0) {
      console.log('No tickets to export');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No tickets to export', count: 0 })
      };
    }
    
    console.log(`Found ${tickets.length} tickets to export`);
    
    // 2. Fetch products for QB Item Code mapping
    const products = await fetchProducts();
    const productCodeMap = buildProductCodeMap(products);
    
    // 3. Get next invoice number
    const startingInvoice = await getNextInvoiceNumber();
    
    // 4. Generate IIF file
    const iifContent = generateIIF(tickets, productCodeMap, startingInvoice, true);
    
    // 5. Send email with IIF attachment
    await sendExportEmail(tickets, iifContent);
    
    // 6. Mark tickets as exported
    await markTicketsExported(tickets.map(t => t.id));
    
    // 7. Update invoice number
    await updateLastInvoiceNumber(startingInvoice + Object.keys(groupByCustomer(tickets)).length - 1);
    
    console.log('Export completed successfully');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketsExported: tickets.length,
        invoiceStart: startingInvoice
      })
    };
    
  } catch (error) {
    console.error('Export failed:', error);
    
    // Send error notification
    await sendErrorEmail(error.message);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function getUnexportedClosedTickets() {
  const filterFormula = `AND({Status}='Closed', NOT({QB Exported}))`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/Tickets?filterByFormula=${encodeURIComponent(filterFormula)}&sort[0][field]=Created&sort[0][direction]=asc`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
  });
  
  const data = await response.json();
  
  return (data.records || []).map(r => ({
    id: r.id,
    number: r.fields['Ticket Number'],
    date: r.fields['Created'] || r.fields['Date'],
    customerName: r.fields['Customer Name'] || 'Unknown',
    productName: r.fields['Product Name'] || 'Unknown',
    productId: r.fields['Product'] ? r.fields['Product'][0] : null,
    truckText: r.fields['Truck Text'] || '',
    netTons: r.fields['Net Tons'] || 0,
    netYards: r.fields['Net Yards'] || 0,
    pricePerTon: r.fields['Price Per Ton'] || 13,
    pumiceCharge: r.fields['Pumice Charge'] || 0,
    totalCharge: r.fields['Total Charge'] || 0,
    address: r.fields['Customer Address'] || '',
    city: r.fields['Customer City'] || '',
    state: r.fields['Customer State'] || '',
    zip: r.fields['Customer Zip'] || ''
  }));
}

async function fetchProducts() {
  const url = `https://api.airtable.com/v0/${BASE_ID}/Products?fields[]=Product%20Name&fields[]=QB%20Item%20Code`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await response.json();
  return (data.records || []).map(r => ({
    id: r.id,
    name: r.fields['Product Name'],
    qbItemCode: r.fields['QB Item Code']
  }));
}

function buildProductCodeMap(products) {
  const map = {};
  const fallback = {
    '3/8 x minus': 'P003', '3/8 x MINUS': 'P003',
    '3/8 x 1/16': 'P013', '1/4 minus': 'P014',
    '3/8 x 1/8': 'P001', '1 x 3/8': 'P005',
    '3/8 x 1/4': 'P009'
  };
  
  products.forEach(p => {
    if (p.qbItemCode) {
      map[p.id] = p.qbItemCode;
      if (p.name) map[p.name.toLowerCase().trim()] = p.qbItemCode;
    }
  });
  
  Object.assign(map, fallback);
  return map;
}

function getQBItemCode(ticket, productCodeMap) {
  if (ticket.productId && productCodeMap[ticket.productId]) return productCodeMap[ticket.productId];
  if (ticket.productName) {
    const key = ticket.productName.toLowerCase().trim();
    if (productCodeMap[key]) return productCodeMap[key];
  }
  return ticket.productName;
}

function groupByCustomer(tickets) {
  return tickets.reduce((acc, t) => {
    if (!acc[t.customerName]) acc[t.customerName] = [];
    acc[t.customerName].push(t);
    return acc;
  }, {});
}

function generateIIF(tickets, productCodeMap, startingInvoice, groupByCustomer) {
  const lines = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tADDR1\tADDR2\tADDR3\tADDR4\tTAXABLE',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tINVITEM\tQNTY\tPRICE\tTAXABLE',
    '!ENDTRNS'
  ];
  
  let invoiceNum = startingInvoice;
  const grouped = groupByCustomer ? this.groupByCustomer(tickets) : null;
  
  if (grouped) {
    for (const customerName of Object.keys(grouped)) {
      const customerTickets = grouped[customerName];
      const first = customerTickets[0];
      let total = 0;
      customerTickets.forEach(t => total += t.totalCharge || t.pumiceCharge || (t.netTons * t.pricePerTon));
      
      const dateStr = formatDate(first.date);
      const addr4 = [first.city, first.state, first.zip].filter(Boolean).join(', ');
      
      lines.push(['TRNS', invoiceNum, 'INVOICE', dateStr, 'Accounts Receivable', customerName, 
        total.toFixed(2), invoiceNum, `Tickets: ${customerTickets.map(t => t.number).join(', ')}`,
        customerName, first.address || '', '', addr4, 'N'].join('\t'));
      
      customerTickets.forEach(t => {
        const amt = t.totalCharge || t.pumiceCharge || (t.netTons * t.pricePerTon);
        const code = getQBItemCode(t, productCodeMap);
        lines.push(['SPL', invoiceNum, 'INVOICE', dateStr, 'Sales', customerName,
          (-amt).toFixed(2), invoiceNum, `Ticket - ${t.number} / ${t.productName} / ${t.truckText}`,
          code, (-t.netTons).toFixed(4), t.pricePerTon.toFixed(2), 'N'].join('\t'));
      });
      
      lines.push('ENDTRNS');
      invoiceNum++;
    }
  }
  
  return lines.join('\n');
}

function formatDate(d) {
  if (!d) return new Date().toLocaleDateString('en-US');
  const date = new Date(d);
  return `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
}

async function getNextInvoiceNumber() {
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/Settings?filterByFormula={Setting Name}='Last Invoice Number'`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await response.json();
    if (data.records && data.records[0]) {
      return parseInt(data.records[0].fields['Setting Value']) + 1;
    }
  } catch (e) {
    console.error('Error getting invoice number:', e);
  }
  return 10001;
}

async function updateLastInvoiceNumber(num) {
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/Settings?filterByFormula={Setting Name}='Last Invoice Number'`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await response.json();
    if (data.records && data.records[0]) {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/Settings/${data.records[0].id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Setting Value': String(num) } })
      });
    }
  } catch (e) {
    console.error('Error updating invoice number:', e);
  }
}

async function markTicketsExported(ticketIds) {
  const today = new Date().toISOString().split('T')[0];
  
  for (const id of ticketIds) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/Tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'QB Exported': true, 'QB Export Date': today } })
    });
  }
}

async function sendExportEmail(tickets, iifContent) {
  const today = new Date().toISOString().split('T')[0];
  const grouped = groupByCustomer(tickets);
  const customerCount = Object.keys(grouped).length;
  
  let totalTons = 0, totalYards = 0;
  tickets.forEach(t => { totalTons += t.netTons; totalYards += t.netYards; });
  
  // Build summary table
  let summaryHtml = '<table border="1" cellpadding="5" style="border-collapse:collapse;"><tr><th>Customer</th><th>Tickets</th><th>Tons</th><th>Yards</th></tr>';
  for (const [name, tix] of Object.entries(grouped)) {
    let tons = 0, yards = 0;
    tix.forEach(t => { tons += t.netTons; yards += t.netYards; });
    summaryHtml += `<tr><td>${name}</td><td>${tix.length}</td><td>${tons.toFixed(2)}</td><td>${yards.toFixed(2)}</td></tr>`;
  }
  summaryHtml += `<tr style="font-weight:bold;"><td>TOTAL</td><td>${tickets.length}</td><td>${totalTons.toFixed(2)}</td><td>${totalYards.toFixed(2)}</td></tr></table>`;
  
  const html = `
    <h2>Beaver Pumice - QuickBooks Export</h2>
    <p><strong>Date:</strong> ${today}</p>
    <p><strong>Tickets:</strong> ${tickets.length} in ${customerCount} invoice(s)</p>
    <p><strong>Total Tons:</strong> ${totalTons.toFixed(2)} | <strong>Total Yards:</strong> ${totalYards.toFixed(2)}</p>
    <h3>By Customer</h3>
    ${summaryHtml}
    <h3>Import Instructions</h3>
    <ol>
      <li>Download the attached .iif file</li>
      <li>Open QuickBooks Desktop</li>
      <li>Go to File > Utilities > Import > IIF Files</li>
      <li>Select the downloaded file and click Open</li>
    </ol>
  `;
  
  const iifBase64 = Buffer.from(iifContent).toString('base64');
  
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ['accounting@beaverpumice.com'],
      cc: ['lucas@beaverpumice.com'],
      subject: `Beaver Pumice Invoices - ${today} - ${tickets.length} tickets`,
      html: html,
      attachments: [{
        filename: `beaver_pumice_invoices_${today}.iif`,
        content: iifBase64
      }]
    })
  });
}

async function sendErrorEmail(errorMessage) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ['lucas@beaverpumice.com', 'chris@resultantai.com'],
      subject: 'Beaver Pumice Export FAILED',
      html: `<h2>Scheduled Export Failed</h2><p>Error: ${errorMessage}</p><p>Please check the system manually.</p>`
    })
  });
}
