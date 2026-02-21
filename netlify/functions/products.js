// netlify/functions/products.js
// v67 - Fetches products from Airtable including QB Item Code

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
  const PRODUCTS_TABLE = 'Products';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Airtable token not configured' })
    };
  }

  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}`,
      {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch products');
    }

    const data = await response.json();

    const products = data.records.map(record => ({
      id: record.id,
      name: record.fields['Product Name'] || '',
      lbsPerYard: record.fields['Weight Per Cubic Yard'] || 0,
      qbItemCode: record.fields['QB Item Code'] || '',
      pricePerTon: record.fields['Price Per Ton'] || null,
      pricePerYard: record.fields['Default Price Per Yard'] || null,
      active: record.fields['Active'] !== false
    })).filter(p => p.name);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, products })
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
