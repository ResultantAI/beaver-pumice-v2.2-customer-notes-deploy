// GET /api/products - Fetches all products from Airtable

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
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const PRODUCTS_TABLE = process.env.AIRTABLE_PRODUCTS_TABLE_ID || 'Products';

  if (!AIRTABLE_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable token' }) };
  }

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Map to portal format - try different possible field names
    const products = data.records.map(record => ({
      id: record.id,
      airtableId: record.id,
      name: record.fields['Product Name'] || record.fields['Product'] || record.fields['Name'] || '',
      lbsPerYard: record.fields['Weight Per Cubic Yard'] || record.fields['WEIGHT PER CUBIC YARD'] || 0,
      priceYard: record.fields['Base Price Yard'] || null,
      priceTon: record.fields['Base Price Ton'] || null,
      qbCode: record.fields['QB Item Code'] || ''
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, count: products.length, products })
    };

  } catch (error) {
    console.error('Error fetching products:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
