// netlify/functions/get-carriers.js
// Fetches all carriers from Airtable

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
  const CARRIERS_TABLE = 'Carriers'; // Using table name

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Airtable token not configured' })
    };
  }

  try {
    let allRecords = [];
    let offset = null;

    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CARRIERS_TABLE)}?pageSize=100&sort[0][field]=Carrier%20Name&sort[0][direction]=asc${offset ? `&offset=${offset}` : ''}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to fetch carriers');
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);

    const carriers = allRecords.map(record => ({
      id: record.id,
      airtableId: record.id,
      name: record.fields['Carrier Name'] || record.fields['Name'] || '',
      phone: record.fields['Contact Phone'] || record.fields['Phone'] || '',
      email: record.fields['Contact Email'] || '',
      address: record.fields['Address'] || '',
      city: record.fields['City'] || '',
      state: record.fields['State'] || '',
      zip: record.fields['Zip'] || ''
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, carriers })
    };

  } catch (error) {
    console.error('Error fetching carriers:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
