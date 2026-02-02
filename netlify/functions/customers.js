// netlify/functions/customers.js
// v2.2 - Added autoEmailTicket field for auto-send on close

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const CUSTOMERS_TABLE = 'Customers';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Airtable token not configured' })
    };
  }

  try {
    let allRecords = [];
    let offset = null;

    // Fetch all records (Airtable paginates at 100)
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CUSTOMERS_TABLE)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to fetch customers');
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);

    // Transform to frontend format with all Phase 2 fields
    const customers = allRecords.map(record => ({
      id: record.id,
      name: record.fields['Customer Name'] || '',
      email: record.fields['Email'] || '',
      phone: record.fields['Phone'] || '',
      
      // Address fields (Bill To)
      address: record.fields['Bill To Address'] || record.fields['Address1'] || '',
      city: record.fields['Bill To City'] || record.fields['City'] || '',
      state: record.fields['Bill To State'] || record.fields['State'] || '',
      zip: record.fields['Bill To Zip'] || record.fields['Zip'] || '',
      
      // Ship To address
      shipToAddress: record.fields['Ship To Address'] || '',
      shipToCity: record.fields['Ship To City'] || '',
      shipToState: record.fields['Ship To State'] || '',
      shipToZip: record.fields['Ship To Zip'] || '',
      
      // Pricing fields
      pricingMethod: record.fields['Pricing Method'] || null,
      priceYard: record.fields['Price Yard'] || null,
      priceTon: record.fields['Price Ton'] || null,
      
      // Freight fields - MUST match Airtable exactly (per_ton, per_yard)
      freightMethod: record.fields['Freight Method'] || null,
      freightRate: record.fields['Freight Rate'] || null,
      freightCostMethod: record.fields['Freight Cost Method'] || null,
      freightCost: record.fields['Freight Cost'] || null,
      
      // QuickBooks
      qbCustomerName: record.fields['QB Customer Name'] || '',
      
      // Linked products
      allowedProducts: record.fields['Allowed Products'] || [],
      
      // Notes
      defaultNote: record.fields['Default Note'] || '',
      billingNotes: record.fields['Billing Notes'] || '',
      
      // v2.2: Auto-email ticket on close
      autoEmailTicket: record.fields['Auto Email Ticket'] || false
    })).filter(c => c.name);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, customers })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
