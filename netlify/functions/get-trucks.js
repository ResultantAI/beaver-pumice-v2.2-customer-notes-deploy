// netlify/functions/get-trucks.js
// Fetches all trucks from Airtable

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
  const TRUCKS_TABLE = 'Trucks';

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
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRUCKS_TABLE)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to fetch trucks');
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);

    const trucks = allRecords.map(record => ({
      id: record.id,
      airtableId: record.id,
      truckId: record.fields['Truck ID'] || record.fields['Name'] || '',
      carrier: record.fields['Carrier Name'] ? record.fields['Carrier Name'][0] : '',
      carrierId: record.fields['Carrier'] ? record.fields['Carrier'][0] : null
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trucks })
    };

  } catch (error) {
    console.error('Error fetching trucks:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
