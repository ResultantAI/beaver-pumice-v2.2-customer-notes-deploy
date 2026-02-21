// netlify/functions/update-carrier.js
// Updates an existing carrier in Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
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

    if (!carrier.id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Carrier ID is required' })
      };
    }

    if (!carrier.name || !carrier.name.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Carrier name is required' })
      };
    }

    // Build Airtable fields - only include fields that have values
    const fields = {
      'Carrier Name': carrier.name.trim()
    };

    // Only add optional fields if they have values (avoids "unknown field" errors)
    if (carrier.phone?.trim()) fields['Contact Phone'] = carrier.phone.trim();
    if (carrier.email?.trim()) fields['Contact Email'] = carrier.email.trim();
    if (carrier.address?.trim()) fields['Address'] = carrier.address.trim();
    if (carrier.city?.trim()) fields['City'] = carrier.city.trim();
    if (carrier.state?.trim()) fields['State'] = carrier.state.trim().toUpperCase();
    if (carrier.zip?.trim()) fields['Zip'] = carrier.zip.trim();

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CARRIERS_TABLE)}/${carrier.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to update carrier');
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
    console.error('Error updating carrier:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
