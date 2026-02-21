// netlify/functions/add-truck.js
// Creates a new truck in Airtable

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
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
    const truckData = JSON.parse(event.body);
    
    // Validate required fields
    if (!truckData.truckId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Truck ID is required' })
      };
    }

    // Build Airtable fields
    const fields = {
      'Truck ID': truckData.truckId,
    };

    // Add linked carrier if provided
    if (truckData.carrierId && truckData.carrierId.startsWith('rec')) {
      fields['Carrier'] = [truckData.carrierId];
    }

    console.log('Creating truck with fields:', JSON.stringify(fields));

    // Create record in Airtable
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRUCKS_TABLE)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable error:', errorData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create truck in Airtable',
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
        message: 'Truck added successfully'
      })
    };

  } catch (error) {
    console.error('Error creating truck:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
