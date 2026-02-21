// netlify/functions/create-ticket.js
// Creates a new ticket in Airtable and returns the record ID for printing

exports.handler = async (event) => {
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    
    // Validate required fields
    const required = ['carrier', 'product', 'gross', 'tare'];
    for (const field of required) {
      if (!data[field]) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing required field: ${field}` })
        };
      }
    }

    // Get environment variables
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
    const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID || 'tblzvNrXOnnW9mdBc';

    if (!AIRTABLE_TOKEN) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error: Missing Airtable token' })
      };
    }

    // Build Airtable record
    // Note: Adjust field names to match your actual Airtable schema
    const airtableFields = {
      'Gross Weight lbs': data.gross,
      'Tare Weight lbs': data.tare,
      'PO Number': data.po || '',
      'Ticket Note': data.note || '',
    };

    // If you have linked record fields, you'll need to look up the record IDs
    // For now, we'll store names directly if your schema supports it
    // Or you may need to adjust based on your actual Airtable field types
    
    // These might be linked records - adjust as needed:
    // 'Customer': [customerRecordId],
    // 'Hauling For': [carrierRecordId],
    // 'Truck': [truckRecordId],
    // 'Product': [productRecordId],

    // Create record in Airtable
    const response = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: airtableFields,
          typecast: true // Allows Airtable to convert values
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable error:', errorData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create ticket in Airtable',
          details: errorData
        })
      };
    }

    const record = await response.json();
    
    // Get the ticket number from the formula field
    const ticketNumber = record.fields['Ticket Number'] || record.fields['Ticket #'] || 'NEW';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: record.id,
        ticketNumber: ticketNumber,
        message: 'Ticket created successfully'
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};
