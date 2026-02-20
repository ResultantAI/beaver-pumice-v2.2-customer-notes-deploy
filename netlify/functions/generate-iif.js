// POST /api/export/iif - Generates QuickBooks Desktop IIF file from tickets
// IIF = Intuit Interchange Format for importing invoices into QuickBooks Desktop

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const requestData = JSON.parse(event.body);
    const { 
      ticketIds,              // Array of ticket record IDs to export
      invoiceDate,            // Date for invoices (MM/DD/YYYY format)
      groupByCustomer,        // Boolean - true = one invoice per customer, false = one per ticket
      startingInvoiceNum,     // Starting invoice number (used when groupByCustomer OR useTicketNumberAsInvoice is false)
      useTicketNumberAsInvoice // Boolean - when true AND not grouping, invoice # = ticket #
    } = requestData;

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No tickets selected for export' }) };
    }

    // Fetch ticket details from Airtable
    const tickets = await fetchTickets(AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ticketIds);
    
    if (tickets.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid tickets found' }) };
    }

    // Fetch customer details with pricing
    const customerIds = [...new Set(tickets.map(t => t.customerId).filter(Boolean))];
    const customers = await fetchCustomers(AIRTABLE_TOKEN, AIRTABLE_BASE_ID, customerIds);

    // Fetch product pricing
    const products = await fetchProducts(AIRTABLE_TOKEN, AIRTABLE_BASE_ID);

    // Generate IIF content
    const iifContent = generateIIF({
      tickets,
      customers,
      products,
      invoiceDate: invoiceDate || formatDate(new Date()),
      groupByCustomer: groupByCustomer !== false,
      startingInvoiceNum: parseInt(startingInvoiceNum) || 10,
      useTicketNumberAsInvoice: useTicketNumberAsInvoice === true
    });

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="invoices_${formatDateForFilename(new Date())}.iif"`
      },
      body: iifContent
    };

  } catch (error) {
    console.error('Error generating IIF:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

// ==================== AIRTABLE FETCH FUNCTIONS ====================

async function fetchTickets(token, baseId, ticketIds) {
  const tickets = [];
  
  // Airtable limits to 100 records per request, batch if needed
  for (let i = 0; i < ticketIds.length; i += 10) {
    const batch = ticketIds.slice(i, i + 10);
    const filterFormula = `OR(${batch.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    
    const url = `https://api.airtable.com/v0/${baseId}/Tickets?filterByFormula=${encodeURIComponent(filterFormula)}`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch tickets: ${response.status}`);
    }
    
    const data = await response.json();
    
    for (const record of data.records) {
      // Try to get QB Item Code from lookup field on ticket (most reliable)
      // Check various possible field names for the lookup
      const qbItemCodeFromLookup = record.fields['QB Item Code (from Product)']?.[0] || 
                                    record.fields['QB Item Code (from Products)']?.[0] ||
                                    record.fields['QB Item Code (from QB Item Code)']?.[0] ||
                                    record.fields['QB Item Code']?.[0] ||
                                    (typeof record.fields['QB Item Code'] === 'string' ? record.fields['QB Item Code'] : null) ||
                                    null;
      
      tickets.push({
        id: record.id,
        number: record.fields['Ticket Number'] || 0,
        customerId: record.fields['Customer']?.[0] || null,
        customerName: record.fields['Customer Name']?.[0] || '',
        carrierId: record.fields['Hauling For']?.[0] || null,
        carrierName: record.fields['Hauling For Name']?.[0] || '',
        productId: record.fields['Product']?.[0] || null,
        productName: record.fields['Product Name']?.[0] || '',
        qbItemCode: qbItemCodeFromLookup,  // QB Item Code from lookup field
        truck: record.fields['Truck Text'] || record.fields['Truck Name']?.[0] || '',
        tare: record.fields['Tare Weight lbs'] || 0,
        gross: record.fields['Gross Weight lbs'] || 0,
        netLbs: record.fields['Net Weight lbs'] || 0,
        netTons: record.fields['Net Tons'] || 0,
        netYards: record.fields['Net Yards'] || 0,
        po: record.fields['PO Number'] || '',
        note: record.fields['Ticket Note'] || '',
        status: record.fields['Status'] || 'Open',
        date: record.fields['Created'] || '',
        // Freight fields - parse currency format (remove $ and commas)
        freightCharge: parseFloat(String(record.fields['Freight Charge'] || '0').replace(/[$,]/g, '')) || 0,
        freightCost: parseFloat(String(record.fields['Freight Cost'] || '0').replace(/[$,]/g, '')) || 0,
        pumiceCharge: parseFloat(String(record.fields['Pumice Charge'] || '0').replace(/[$,]/g, '')) || 0,
        totalCharge: parseFloat(String(record.fields['Total Charge'] || '0').replace(/[$,]/g, '')) || 0
      });
      
      console.log(`Fetched ticket ${record.fields['Ticket Number']}: productName="${record.fields['Product Name']?.[0]}", freightCharge=${record.fields['Freight Charge'] || 0}`);
    }
  }
  
  return tickets;
}

async function fetchCustomers(token, baseId, customerIds) {
  const customers = {};
  
  if (customerIds.length === 0) return customers;
  
  for (let i = 0; i < customerIds.length; i += 10) {
    const batch = customerIds.slice(i, i + 10);
    const filterFormula = `OR(${batch.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    
    const url = `https://api.airtable.com/v0/${baseId}/Customers?filterByFormula=${encodeURIComponent(filterFormula)}`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) continue;
    
    const data = await response.json();
    
    for (const record of data.records) {
      const f = record.fields;
      const customerName = f['Customer Name'] || '';
      
      // v69: Log ALL raw field data for debugging
      console.log(`=== RAW AIRTABLE DATA: ${customerName} ===`);
      console.log(`  All fields: ${JSON.stringify(f)}`);
      
      // Helper to parse currency values (handles $20.00, 20, "20", etc.)
      const parseCurrency = (val) => {
        if (val === null || val === undefined || val === '') return null;
        const num = parseFloat(String(val).replace(/[$,\s]/g, ''));
        return isNaN(num) || num === 0 ? null : num;
      };
      
      // Get prices - try multiple field name variations
      const priceYard = parseCurrency(f['Price Yard'] || f['Price Per Yard'] || f['PriceYard']);
      const priceTon = parseCurrency(f['Price Ton'] || f['Price Per Ton'] || f['PriceTon']);
      
      console.log(`  Price Yard raw: "${f['Price Yard']}" -> parsed: ${priceYard}`);
      console.log(`  Price Ton raw: "${f['Price Ton']}" -> parsed: ${priceTon}`);
      
      // Get freight - try multiple field name variations  
      // v71: IMPORTANT - 'Freight Rate' is what customer pays (for invoices)
      //                  'Freight Cost' is what BP pays carrier (internal tracking)
      // For IIF export, we need 'Freight Rate' (customer charge)
      const freightRate = parseCurrency(f['Freight Rate'] || f['FreightRate'] || f['Freight Per Ton'] || f['FreightPerTon']);
      const freightPerTon = parseCurrency(f['Freight Per Ton'] || f['FreightPerTon']);
      
      console.log(`  Freight Rate raw: "${f['Freight Rate']}" -> parsed: ${freightRate}`);
      console.log(`  Freight Cost raw: "${f['Freight Cost']}" (internal, not used for invoices)`);
      
      // Determine pricing method - check multiple field names
      let pricingMethod = f['Pricing Method'] || f['Billing Method'] || f['Pumice Unit'] || f['Product Unit'] || '';
      
      console.log(`  Pricing Method field: "${f['Pricing Method']}"`);
      console.log(`  Product Unit field: "${f['Product Unit']}"`);
      
      // If no explicit method, check Billing Type (1-7) legacy system
      if (!pricingMethod) {
        const billingType = String(f['Billing Type'] || '').trim();
        if (['1', '3', '4', '5', '6'].includes(billingType)) {
          pricingMethod = 'per_yard';
          console.log(`  Inferred per_yard from Billing Type ${billingType}`);
        } else if (['2', '7'].includes(billingType)) {
          pricingMethod = 'per_ton';
          console.log(`  Inferred per_ton from Billing Type ${billingType}`);
        }
      }
      
      // Final fallback: infer from which price field is populated
      if (!pricingMethod) {
        if (priceYard && !priceTon) {
          pricingMethod = 'per_yard';
          console.log(`  Inferred per_yard because only Price Yard is set`);
        } else if (priceTon && !priceYard) {
          pricingMethod = 'per_ton';
          console.log(`  Inferred per_ton because only Price Ton is set`);
        } else if (priceTon && priceYard) {
          // Both set - default to ton unless method explicitly says yard
          pricingMethod = 'per_ton';
          console.log(`  Both prices set, defaulting to per_ton`);
        }
      }
      
      // Get freight method - check multiple field names
      // v70: Added 'Freight Cost Method' which some customers use
      let freightMethod = f['Freight Method'] || f['Freight Cost Method'] || f['Freight Unit'] || '';
      
      console.log(`  Freight Method field: "${f['Freight Method']}"`);
      console.log(`  Freight Cost Method field: "${f['Freight Cost Method']}"`);
      console.log(`  Freight Unit field: "${f['Freight Unit']}"`);
      console.log(`  --> Using freightMethod: "${freightMethod}"`)
      
      // If no explicit freight method but has freight rate, default to per_ton
      // FIX v72: Previously defaulted to match product unit (pricingMethod), which caused
      // per-yard product customers (e.g., Granite) to have freight charged per yard too.
      // Freight and product are billed independently — freight defaults to per_ton.
      if (!freightMethod && (freightRate || freightPerTon)) {
        freightMethod = 'per_ton';
        console.log(`  Inferred freight method: per_ton (default - set Freight Unit in Airtable to override)`);
      }
      
      const customer = {
        id: record.id,
        name: customerName,
        address1: f['Bill To Address'] || f['Address1'] || '',
        city: f['Bill To City'] || f['City'] || '',
        state: f['Bill To State'] || f['State'] || '',
        zip: f['Bill To Zip'] || f['Zip'] || '',
        pricingMethod: (pricingMethod || '').toLowerCase(),
        priceYard: priceYard,
        priceTon: priceTon,
        freightMethod: (freightMethod || '').toLowerCase(),
        freightRate: freightRate,
        freightPerTon: freightPerTon,
        qbProductCode: f['QB Product Code'] || null
      };
      
      customers[record.id] = customer;
      
      console.log(`  FINAL: pricingMethod="${customer.pricingMethod}", priceYard=${customer.priceYard}, priceTon=${customer.priceTon}`);
      console.log(`  FINAL: freightMethod="${customer.freightMethod}", freightRate=${customer.freightRate}`);
    }
  }
  
  return customers;
}

async function fetchProducts(token, baseId) {
  const products = {};
  const productsByName = {}; // Also index by name for fallback lookup
  
  // v69: Explicitly request QB Item Code field
  const fields = ['Product Name', 'Weight Per Cubic Yard', 'Price Per Ton', 'QB Item Code'];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  const url = `https://api.airtable.com/v0/${baseId}/Products?${fieldParams}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) return { byId: products, byName: productsByName };
  
  const data = await response.json();
  
  console.log(`Loaded ${data.records.length} products from Airtable`);
  
  for (const record of data.records) {
    // v69: Log all fields for debugging
    console.log(`Product record fields:`, JSON.stringify(record.fields));
    
    // v69: Try multiple field name variations for QB Item Code
    const qbCode = record.fields['QB Item Code'] || 
                   record.fields['QB_Item_Code'] ||
                   record.fields['qb_item_code'] ||
                   record.fields['QBItemCode'] ||
                   record.fields['Item Code'] ||
                   null;
    
    const productData = {
      id: record.id,
      name: record.fields['Product Name'] || '',
      lbsPerYard: record.fields['Weight Per Cubic Yard'] || 1350,
      pricePerTon: record.fields['Price Per Ton'] || 13,
      qbItemCode: qbCode
    };
    products[record.id] = productData;
    
    // Also index by name (lowercase for case-insensitive lookup)
    if (productData.name) {
      productsByName[productData.name.toLowerCase().trim()] = productData;
      console.log(`Product "${productData.name}" -> QB Item Code: "${productData.qbItemCode}"`);
    }
  }
  
  return { byId: products, byName: productsByName };
}

// ==================== IIF GENERATION ====================

function generateIIF({ tickets, customers, products, invoiceDate, groupByCustomer, startingInvoiceNum, useTicketNumberAsInvoice }) {
  const lines = [];
  
  // IIF Header rows
  lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tNAMEISTAXABLE\tADDR1\tADDR2\tADDR3\tADDR4\tTERMS\tSHIPVIA\tSHIPDATE\tPONUM');
  lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tQNTY\tPRICE\tINVITEM\tTAXABLE\tOTHER2\tYEARTODATE\tWAGEBASE\tEXTRA');
  lines.push('!ENDTRNS');
  
  let invoiceNum = startingInvoiceNum;
  
  if (groupByCustomer) {
    // Group tickets by customer
    const ticketsByCustomer = {};
    for (const ticket of tickets) {
      const custId = ticket.customerId || 'UNKNOWN';
      if (!ticketsByCustomer[custId]) {
        ticketsByCustomer[custId] = [];
      }
      ticketsByCustomer[custId].push(ticket);
    }
    
    // Generate one invoice per customer
    for (const [customerId, customerTickets] of Object.entries(ticketsByCustomer)) {
      const customer = customers[customerId] || {
        name: customerTickets[0]?.customerName || 'Unknown Customer',
        address1: '', city: '', state: '', zip: ''
      };
      
      const invoiceLines = generateInvoiceLines(invoiceNum, invoiceDate, customer, customerTickets, products);
      lines.push(...invoiceLines);
      invoiceNum++;
    }
  } else {
    // One invoice per ticket
    for (const ticket of tickets) {
      const customer = customers[ticket.customerId] || {
        name: ticket.customerName || 'Unknown Customer',
        address1: '', city: '', state: '', zip: ''
      };
      
      // Use ticket number as invoice number if option is enabled
      const thisInvoiceNum = useTicketNumberAsInvoice ? ticket.number : invoiceNum;
      
      const invoiceLines = generateInvoiceLines(thisInvoiceNum, invoiceDate, customer, [ticket], products);
      lines.push(...invoiceLines);
      invoiceNum++;
    }
  }
  
  // Add trailing newline
  lines.push('');
  
  return lines.join('\n');
}

function generateInvoiceLines(invoiceNum, invoiceDate, customer, tickets, products) {
  const lines = [];
  
  // Calculate total for all tickets in this invoice
  let invoiceTotal = 0;
  const splLines = [];
  
  for (const ticket of tickets) {
    // Try to find product by ID first, then by name
    let product = products.byId[ticket.productId];
    let lookupMethod = 'byId';
    
    if (!product && ticket.productName) {
      // Fallback: lookup by product name
      product = products.byName[ticket.productName.toLowerCase().trim()];
      lookupMethod = 'byName';
    }
    if (!product) {
      product = { name: ticket.productName, pricePerTon: 13, qbItemCode: null };
      lookupMethod = 'fallback';
    }
    
    // v69: Enhanced QB Item Code resolution with detailed logging
    // Priority for QB Item Code:
    // 1. ticket.qbItemCode (from lookup field on Tickets table)
    // 2. product.qbItemCode (from Products table - MOST RELIABLE)
    // 3. null (will fall back to product name)
    let qbItemCodeSource = null;
    let codeSource = 'none';
    
    if (ticket.qbItemCode) {
      qbItemCodeSource = ticket.qbItemCode;
      codeSource = 'ticket-lookup';
    } else if (product.qbItemCode) {
      qbItemCodeSource = product.qbItemCode;
      codeSource = 'product-table';
    }
    
    console.log(`Ticket ${ticket.number}: Product lookup ${lookupMethod}, productId="${ticket.productId}", productName="${ticket.productName}"`);
    console.log(`  -> product.name="${product.name}", product.qbItemCode="${product.qbItemCode}"`);
    console.log(`  -> qbItemCodeSource="${qbItemCodeSource}" (from ${codeSource})`)
    
    const tons = ticket.netTons || 0;
    const yards = ticket.netYards || 0;
    
    // v69: Enhanced billing logic with explicit customer data logging
    console.log(`Ticket ${ticket.number}: Customer pricing data:`);
    console.log(`  -> pricingMethod="${customer.pricingMethod}"`);
    console.log(`  -> priceYard=${customer.priceYard}, priceTon=${customer.priceTon}`);
    console.log(`  -> Ticket: ${tons.toFixed(4)} tons, ${yards.toFixed(4)} yards`);
    
    // Determine billing method
    // Priority: explicit pricingMethod > infer from which price is set > default to ton
    let billByYard = false;
    let billingReason = '';
    
    if (customer.pricingMethod) {
      // Explicit method set - check for 'yard' anywhere in string
      const method = customer.pricingMethod.toLowerCase();
      billByYard = method.includes('yard');
      billingReason = `explicit method "${customer.pricingMethod}"`;
    } else if (customer.priceYard && !customer.priceTon) {
      // Only yard price set
      billByYard = true;
      billingReason = 'only priceYard is set';
    } else if (customer.priceTon && !customer.priceYard) {
      // Only ton price set
      billByYard = false;
      billingReason = 'only priceTon is set';
    } else if (customer.priceYard && customer.priceTon) {
      // Both set - use ton unless method says yard
      billByYard = false;
      billingReason = 'both prices set, defaulting to ton';
    } else {
      // Neither set - use default
      billByYard = false;
      billingReason = 'no customer pricing, using default';
    }
    
    console.log(`  -> billByYard=${billByYard} (${billingReason})`);
    
    // Determine quantity and price based on billing method
    let quantity, pricePerUnit;
    
    if (billByYard) {
      // Bill by yards
      quantity = Math.round(yards * 100) / 100;
      pricePerUnit = customer.priceYard || 13;  // Default $13/yard
      console.log(`Ticket ${ticket.number}: BILLING BY YARD - ${quantity} yards @ $${pricePerUnit}/yard`);
    } else {
      // Bill by tons
      quantity = Math.round(tons * 100) / 100;
      pricePerUnit = customer.priceTon || product.pricePerTon || 13;  // Customer rate, or product rate, or $13 default
      console.log(`Ticket ${ticket.number}: BILLING BY TON - ${quantity} tons @ $${pricePerUnit}/ton`);
    }
    
    // v69: Ensure price is rounded to 2 decimals
    pricePerUnit = Math.round(pricePerUnit * 100) / 100;
    
    // Get freight rate
    const freightRateValue = customer.freightRate || customer.freightPerTon || null;
    
    // Product line item - calculate from rounded values
    // v69: Round final amount to 2 decimals
    const productAmount = Math.round(quantity * pricePerUnit * 100) / 100;
    invoiceTotal += productAmount;
    
    // Build memo: "Ticket - {number} / {product} / {truck/note}"
    let memo = `Ticket - ${ticket.number} / ${ticket.productName || product.name}`;
    if (ticket.truck) memo += ` / ${ticket.truck}`;
    if (ticket.po) memo += ` ${ticket.po}`;
    
    // Determine QuickBooks Item Code - use ticket/product QB code, or fallback to name mapping
    const qbItemCode = getQBItemCode(ticket.productName || product.name, qbItemCodeSource);
    console.log(`Ticket ${ticket.number}: Final qbItemCode="${qbItemCode}"`);
    
    // Product SPL line
    splLines.push([
      'SPL',
      invoiceNum,                    // SPLID
      'INVOICE',                     // TRNSTYPE
      invoiceDate,                   // DATE
      'Sales',                       // ACCNT
      customer.name,                 // NAME
      '',                            // CLASS
      (-productAmount).toFixed(2),   // AMOUNT (negative)
      '',                            // DOCNUM
      memo,                          // MEMO
      '',                            // CLEAR
      (-quantity).toFixed(2),        // QNTY (negative) - yards or tons, matches ticket display
      pricePerUnit.toFixed(2),       // PRICE (positive) - ensure 2 decimal precision
      qbItemCode,                    // INVITEM
      'N',                           // TAXABLE
      '', '', '', ''                 // OTHER2, YEARTODATE, WAGEBASE, EXTRA
    ].join('\t'));
    
    // Freight line item
    // v69: ALWAYS recalculate freight from customer rate - don't trust ticket.freightCharge
    // IMPORTANT: Skip freight entirely if customer has no freight rate configured
    let freightAmount = 0;
    let freightQty = 1;
    let freightPrice = 0;
    
    console.log(`Ticket ${ticket.number}: Freight calculation:`);
    console.log(`  -> freightMethod="${customer.freightMethod}", freightRate=${customer.freightRate}`);
    console.log(`  -> ticket.freightCharge=${ticket.freightCharge} (will recalculate)`);
    
    // Check if customer has freight configured
    const hasFreightRate = freightRateValue && freightRateValue > 0;
    const freightMethod = (customer.freightMethod || '').toLowerCase();
    const isFreightPerTon = freightMethod.includes('ton');
    const isFreightPerYard = freightMethod.includes('yard');
    
    if (!hasFreightRate) {
      // Customer has no freight rate - skip freight
      console.log(`  -> No freight - customer has no freight rate configured`);
    } else if (isFreightPerYard && yards > 0) {
      // Per-yard freight: qty = yards, price = rate per yard
      freightQty = Math.round(yards * 100) / 100;
      freightPrice = Math.round(freightRateValue * 100) / 100;
      freightAmount = Math.round(freightQty * freightPrice * 100) / 100;
      console.log(`  -> Freight PER YARD: ${freightQty} yards @ $${freightPrice}/yard = $${freightAmount}`);
    } else if (isFreightPerTon && tons > 0) {
      // Per-ton freight: qty = tons, price = rate per ton
      freightQty = Math.round(tons * 100) / 100;
      freightPrice = Math.round(freightRateValue * 100) / 100;
      freightAmount = Math.round(freightQty * freightPrice * 100) / 100;
      console.log(`  -> Freight PER TON: ${freightQty} tons @ $${freightPrice}/ton = $${freightAmount}`);
    } else if (hasFreightRate) {
      // No explicit method but has rate - match product billing unit
      if (billByYard && yards > 0) {
        freightQty = Math.round(yards * 100) / 100;
        freightPrice = Math.round(freightRateValue * 100) / 100;
        freightAmount = Math.round(freightQty * freightPrice * 100) / 100;
        console.log(`  -> Freight (matching product yard): ${freightQty} yards @ $${freightPrice}/yard = $${freightAmount}`);
      } else if (tons > 0) {
        freightQty = Math.round(tons * 100) / 100;
        freightPrice = Math.round(freightRateValue * 100) / 100;
        freightAmount = Math.round(freightQty * freightPrice * 100) / 100;
        console.log(`  -> Freight (matching product ton): ${freightQty} tons @ $${freightPrice}/ton = $${freightAmount}`);
      } else {
        // Flat freight
        freightQty = 1;
        freightPrice = Math.round(freightRateValue * 100) / 100;
        freightAmount = freightPrice;
        console.log(`  -> Freight FLAT: $${freightAmount}`);
      }
    }
    
    if (freightAmount > 0) {
      // v69: Round invoice total addition
      invoiceTotal += Math.round(freightAmount * 100) / 100;
      
      // Freight SPL line - use TRK item code with Truck Freight account
      splLines.push([
        'SPL',
        invoiceNum,
        'INVOICE',
        invoiceDate,
        'Truck Freight',               // Account for freight (matches QB TRK item)
        customer.name,
        '',
        (-freightAmount).toFixed(2),
        '',
        `Freight - Ticket ${ticket.number}`,  // Clearer memo for freight
        '',
        (-freightQty).toFixed(2),      // QNTY (negative) - tons for per-ton, 1 for flat
        freightPrice.toFixed(2),       // PRICE - rate per ton or flat amount
        'TRK',                         // Use TRK item code for freight
        'N',
        '', '', '', ''
      ].join('\t'));
      
      console.log(`Ticket ${ticket.number}: Added freight line - qty=${freightQty}, price=$${freightPrice}, amount=$${freightAmount}`);
    }
  }
  
  // Format customer address
  const addr2 = customer.address1 || '';
  const addr4 = [customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || '';
  
  // Get PO from first ticket (for multi-ticket invoices)
  const poNumber = tickets[0]?.po || '';
  
  // TRNS line (invoice header)
  lines.push([
    'TRNS',
    invoiceNum,                    // TRNSID
    'INVOICE',                     // TRNSTYPE
    invoiceDate,                   // DATE
    'Accounts Receivable',         // ACCNT
    customer.name,                 // NAME
    '',                            // CLASS
    (Math.round(invoiceTotal * 100) / 100).toFixed(2),  // AMOUNT - v69: ensure final rounding
    invoiceNum,                    // DOCNUM
    '',                            // MEMO
    '', '', '',                    // CLEAR, TOPRINT, NAMEISTAXABLE
    customer.name,                 // ADDR1
    addr2,                         // ADDR2
    '',                            // ADDR3
    addr4,                         // ADDR4
    '', '', '',                    // TERMS, SHIPVIA, SHIPDATE
    poNumber                       // PONUM
  ].join('\t'));
  
  // Add all SPL lines
  lines.push(...splLines);
  
  // ENDTRNS
  lines.push('ENDTRNS');
  
  return lines;
}

// Map product names to QuickBooks item codes
// v74: Expanded fallback mappings with all known product variations
// Added validation to ensure QB codes are actually valid (P001, P003, etc.)
function getQBItemCode(productName, customCode) {
  // v74: Validate that customCode looks like a real QB code (Pxxx or "Freight")
  const isValidQBCode = (code) => {
    if (!code) return false;
    const trimmed = String(code).trim();
    // Valid codes: P001-P999, or "Freight"
    return /^P\d{3}$/.test(trimmed) || trimmed.toLowerCase() === 'freight';
  };
  
  // Use custom code from Airtable ONLY if it's a valid QB code format
  if (customCode && isValidQBCode(customCode)) {
    console.log(`getQBItemCode v74: Using validated Airtable code for "${productName}" -> "${customCode}"`);
    return customCode;
  }
  
  if (customCode) {
    console.log(`getQBItemCode v74: WARNING - Airtable returned invalid QB code "${customCode}" for "${productName}", using fallback`);
  }
  
  // v70: Comprehensive fallback mapping for ALL known products
  const productMapping = {
    // P001 - 3/8 x 1/8
    '3/8 x 1/8': 'P001',
    '3/8x1/8': 'P001',
    
    // P002 - 3/4 x 3/8
    '3/4 x 3/8': 'P002',
    '3/4x3/8': 'P002',
    
    // P003 - 3/8 x MINUS (ALL variations)
    '3/8 x minus': 'P003',
    '3/8 x MINUS': 'P003',
    '3/8 minus': 'P003',
    '3/8xminus': 'P003',
    '3/8 MINUS': 'P003',
    '3/8MINUS': 'P003',
    '3/8 X MINUS': 'P003',
    '3/8X MINUS': 'P003',
    '3/8x MINUS': 'P003',
    
    // P004 - birds eye
    'birds eye': 'P004',
    '1/8 #8': 'P004',
    
    // P005 - 1 x 3/8
    '1 x 3/8': 'P005',
    '1x3/8': 'P005',
    '1 x3/8': 'P005',
    
    // P008 - pumice-
    'pumice-': 'P008',
    
    // P009 - 3/8 x 1/4
    '3/8 x 1/4': 'P009',
    '3/8x1/4': 'P009',
    
    // P010 - 3/8 MIN
    '3/8 x MIN': 'P010',
    '3/8 MIN': 'P010',
    '3/8xMIN': 'P010',
    
    // P011 - 3/4 x 1/2
    '3/4 x 1/2': 'P011',
    '3/4x1/2': 'P011',
    
    // P013 - 3/8 x 1/16 (ALL variations)
    '3/8 x 1/16': 'P013',
    '3/8x1/16': 'P013',
    '3/8 X 1/16': 'P013',
    '3/8X1/16': 'P013',
    
    // P014 - 1/4 minus (ALL variations)
    '1/4 minus': 'P014',
    '1/4minus': 'P014',
    '1/4 MINUS': 'P014',
    '1/4 x minus': 'P014',
    '1/4 x MINUS': 'P014',
    '1/4xminus': 'P014',
    
    // Freight
    'freight': 'Freight',
    'Freight': 'Freight'
  };
  
  // Try exact match first
  if (productMapping[productName]) {
    console.log(`getQBItemCode v74: EXACT match "${productName}" -> "${productMapping[productName]}"`);
    return productMapping[productName];
  }
  
  // Try case-insensitive match
  const lowerName = (productName || '').toLowerCase().trim();
  for (const [key, value] of Object.entries(productMapping)) {
    if (key.toLowerCase() === lowerName) {
      console.log(`getQBItemCode v74: LOWERCASE match "${productName}" -> "${value}"`);
      return value;
    }
  }
  
  // Try contains match (for variations like "3/8 x 1/16 Pumice")
  for (const [key, value] of Object.entries(productMapping)) {
    if (lowerName.includes(key.toLowerCase())) {
      console.log(`getQBItemCode v74: CONTAINS match "${productName}" -> "${value}"`);
      return value;
    }
  }
  
  // Try no-space match
  const noSpaces = lowerName.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(productMapping)) {
    if (noSpaces === key.toLowerCase().replace(/\s+/g, '')) {
      console.log(`getQBItemCode v74: NO-SPACE match "${productName}" -> "${value}"`);
      return value;
    }
  }
  
  // No match - return product name (will cause QB error, alerting user)
  console.log(`getQBItemCode v74: CRITICAL WARNING - No mapping for "${productName}" - QB import WILL fail!`);
  return productName;
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(date) {
  const d = new Date(date);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function formatDateForFilename(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}
