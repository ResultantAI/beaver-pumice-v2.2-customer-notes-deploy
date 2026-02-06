// GET /api/customers - Fetches all customers from Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const CUSTOMERS_TABLE_ID = process.env.AIRTABLE_CUSTOMERS_TABLE_ID || 'tblAQKBdGWHeLz1WO';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    let allRecords = [];
    let offset = null;

    do {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}${offset ? `?offset=${offset}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status}`);
      }

      const data = await response.json();
      
      const mappedRecords = data.records.map(record => ({
        id: record.id,
        name: record.fields['Customer Name'] || '',
        email: record.fields['Email'] || '',
        phone: record.fields['Phone'] || '',
        // Bill To (for invoicing)
        billToEmail: record.fields['Bill To Email'] || '',
        billToAddress: record.fields['Bill To Address'] || '',
        billToCity: record.fields['Bill To City'] || '',
        billToState: record.fields['Bill To State'] || '',
        billToZip: record.fields['Bill To Zip'] || '',
        // Ship To Address (delivery destination)
        shipToAddress: record.fields['Ship To Address'] || '',
        shipToCity: record.fields['Ship To City'] || '',
        shipToState: record.fields['Ship To State'] || '',
        shipToZip: record.fields['Ship To Zip'] || '',
        // Legacy address fields (for backwards compatibility)
        address1: record.fields['Bill To Address'] || record.fields['Address1'] || '',
        city: record.fields['Bill To City'] || record.fields['City'] || '',
        state: record.fields['Bill To State'] || record.fields['State'] || '',
        zip: record.fields['Bill To Zip'] || record.fields['Zip'] || '',
        pricingMethod: record.fields['Pricing Method'] || '',
        priceYard: record.fields['Price Yard'] || null,
        priceTon: record.fields['Price Ton'] || null,
        // Phase 2: Allowed Products for customer-product filtering
        allowedProducts: record.fields['Allowed Products'] || [], // Array of Product record IDs
        contactEmail: record.fields['Contact Email'] || '',
        emailReceipts: record.fields['Email Receipts'] || false,
        qbCustomerName: record.fields['QB Customer Name'] || '',
        defaultNote: record.fields['Default Note'] || '', // Note that appears on all tickets for this customer
        billingType: record.fields['Billing Type'] || '1', // 1-7 or C for custom
        billingNotes: record.fields['Billing Notes'] || '', // Special billing instructions
        // Freight settings (when BP arranges trucking)
        freightMethod: record.fields['Freight Method'] || '', // per_ton, per_yard, flat, delivered - for customer billing
        freightRate: record.fields['Freight Rate'] || null, // What customer pays for freight (rate per unit)
        freightCostMethod: record.fields['Freight Cost Method'] || '', // per_ton, per_yard, flat - for truck payment (can differ from freightMethod)
        freightCost: record.fields['Freight Cost'] || null, // What BP pays carrier (rate per unit)
      }));

      allRecords = allRecords.concat(mappedRecords);
      offset = data.offset;

    } while (offset);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, count: allRecords.length, customers: allRecords })
    };

  } catch (error) {
    console.error('Error fetching customers:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
