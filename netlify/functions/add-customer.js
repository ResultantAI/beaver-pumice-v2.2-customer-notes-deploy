// POST /api/customers/add - Creates a new customer in Airtable

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
  const CUSTOMERS_TABLE_ID = process.env.AIRTABLE_CUSTOMERS_TABLE_ID || 'tblAQKBdGWHeLz1WO';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const customer = JSON.parse(event.body);

    if (!customer.name || !customer.name.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Customer name is required' }) };
    }

    const fields = { 'Customer Name': customer.name.trim() };

    if (customer.email) fields['Email'] = customer.email.trim();
    if (customer.phone) fields['Phone'] = customer.phone.trim();
    if (customer.address1) fields['Address1'] = customer.address1.trim();
    if (customer.city) fields['City'] = customer.city.trim();
    if (customer.state) fields['State'] = customer.state.trim();
    if (customer.zip) fields['Zip'] = customer.zip.trim();
    if (customer.notes) fields['Notes'] = customer.notes.trim();
    
    if (customer.priceYard !== null && customer.priceYard !== undefined && customer.priceYard !== '') {
      const priceYard = parseFloat(customer.priceYard);
      if (!isNaN(priceYard)) fields['Price Yard'] = priceYard;
    }
    if (customer.priceTon !== null && customer.priceTon !== undefined && customer.priceTon !== '') {
      const priceTon = parseFloat(customer.priceTon);
      if (!isNaN(priceTon)) fields['Price Ton'] = priceTon;
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Airtable API error: ${response.status}`);
    }

    const record = await response.json();

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        customer: {
          id: record.id,
          name: record.fields['Customer Name'] || '',
          email: record.fields['Email'] || '',
          phone: record.fields['Phone'] || '',
          address1: record.fields['Address1'] || '',
          city: record.fields['City'] || '',
          state: record.fields['State'] || '',
          zip: record.fields['Zip'] || '',
          priceYard: record.fields['Price Yard'] || null,
          priceTon: record.fields['Price Ton'] || null,
          notes: record.fields['Notes'] || record.fields['Default Note'] || '',
        }
      })
    };

  } catch (error) {
    console.error('Error creating customer:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
