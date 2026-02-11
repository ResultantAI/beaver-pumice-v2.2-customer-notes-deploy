// POST /api/customers/update - Updates an existing customer in Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const CUSTOMERS_TABLE_ID = process.env.AIRTABLE_CUSTOMERS_TABLE_ID || 'tblAQKBdGWHeLz1WO';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const { id, ...customer } = data;

    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Customer ID is required' }) };
    }

    if (!customer.name || !customer.name.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Customer name is required' }) };
    }

    const fields = {
      'Customer Name': customer.name.trim(),
      'Email': customer.email?.trim() || '',
      'Phone': customer.phone?.trim() || '',
      'Address1': customer.address1?.trim() || '',
      'City': customer.city?.trim() || '',
      'State': customer.state?.trim() || '',
      'Zip': customer.zip?.trim() || '',
      'Notes': customer.notes?.trim() || ''
    };
    
    if (customer.priceYard !== null && customer.priceYard !== undefined && customer.priceYard !== '') {
      const priceYard = parseFloat(customer.priceYard);
      if (!isNaN(priceYard)) fields['Price Yard'] = priceYard;
    } else {
      fields['Price Yard'] = null;
    }
    
    if (customer.priceTon !== null && customer.priceTon !== undefined && customer.priceTon !== '') {
      const priceTon = parseFloat(customer.priceTon);
      if (!isNaN(priceTon)) fields['Price Ton'] = priceTon;
    } else {
      fields['Price Ton'] = null;
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}/${id}`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (response.status === 404) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Customer not found' }) };
      }
      throw new Error(errorData.error?.message || `Airtable API error: ${response.status}`);
    }

    const record = await response.json();

    return {
      statusCode: 200,
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
    console.error('Error updating customer:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
