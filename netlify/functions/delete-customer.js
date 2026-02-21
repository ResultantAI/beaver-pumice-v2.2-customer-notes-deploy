// POST /api/customers/delete - Deletes a customer from Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
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
    const { id } = data;

    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Customer ID is required' }) };
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}/${id}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Customer not found' }) };
      }
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Airtable API error: ${response.status}`);
    }

    const result = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, deleted: true, id: result.id })
    };

  } catch (error) {
    console.error('Error deleting customer:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
