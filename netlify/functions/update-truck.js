// netlify/functions/update-truck.js
// Updates an existing truck record in Airtable

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
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
    const data = JSON.parse(event.body);
    const { id, truckId, carrierId } = data;

    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Truck Airtable record ID is required' })
      };
    }

    if (!truckId || !truckId.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Truck ID (name/number) is required' })
      };
    }

    const fields = {
      'Truck ID': truckId.trim()
    };

    // Only update carrier link if a valid Airtable record ID is provided
    if (carrierId && carrierId.startsWith('rec')) {
      fields['Carrier'] = [carrierId];
    }

    console.log(`Updating truck ${id} with fields:`, JSON.stringify(fields));

    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRUCKS_TABLE)}/${id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable error updating truck:', errorData);
      if (response.status === 404) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Truck record not found in Airtable' })
        };
      }
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to update truck in Airtable',
          details: errorData
        })
      };
    }

    const record = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: record.id,
        truckId: record.fields['Truck ID'],
        message: 'Truck updated successfully'
      })
    };

  } catch (error) {
    console.error('Error updating truck:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
