// netlify/functions/add-carrier.js
// Creates a new carrier in Airtable

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
  const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const CARRIERS_TABLE = 'Carriers';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Airtable token not configured' })
    };
  }

  try {
    const carrier = JSON.parse(event.body);

    if (!carrier.name || !carrier.name.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Carrier name is required' })
      };
    }

    // Build Airtable fields
    const fields = {
      'Carrier Name': carrier.name.trim()
    };

    // Add optional fields if provided
    if (carrier.phone) fields['Contact Phone'] = carrier.phone.trim();
    if (carrier.email) fields['Contact Email'] = carrier.email.trim();
    if (carrier.address) fields['Address'] = carrier.address.trim();
    if (carrier.city) fields['City'] = carrier.city.trim();
    if (carrier.state) fields['State'] = carrier.state.trim().toUpperCase();
    if (carrier.zip) fields['Zip'] = carrier.zip.trim();

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CARRIERS_TABLE)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to create carrier');
    }

    const record = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        carrier: {
          id: record.id,
          airtableId: record.id,
          name: record.fields['Carrier Name'] || '',
          phone: record.fields['Contact Phone'] || '',
          email: record.fields['Contact Email'] || '',
          address: record.fields['Address'] || '',
          city: record.fields['City'] || '',
          state: record.fields['State'] || '',
          zip: record.fields['Zip'] || ''
        }
      })
    };

  } catch (error) {
    console.error('Error creating carrier:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
