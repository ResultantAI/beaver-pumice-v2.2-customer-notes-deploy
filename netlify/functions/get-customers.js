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
        address1: record.fields['Address1'] || '',
        city: record.fields['City'] || '',
        state: record.fields['State'] || '',
        zip: record.fields['Zip'] || '',
        priceYard: record.fields['Price Yard'] || null,
        priceTon: record.fields['Price Ton'] || null,
        notes: record.fields['Notes'] || record.fields['Default Note'] || '',
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
