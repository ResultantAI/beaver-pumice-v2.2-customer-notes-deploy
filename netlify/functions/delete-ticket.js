// netlify/functions/delete-ticket.js
// Deletes a single ticket from Airtable (admin only)

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow DELETE
  if (event.httpMethod !== 'DELETE') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed. Use DELETE.' })
    };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const TICKETS_TABLE = process.env.AIRTABLE_TICKETS_TABLE_ID || 'Tickets';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Airtable token not configured' })
    };
  }

  try {
    // Get ticket ID from query string or body
    let ticketId = event.queryStringParameters?.id;
    
    if (!ticketId && event.body) {
      const body = JSON.parse(event.body);
      ticketId = body.id;
    }

    if (!ticketId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing ticket ID. Provide ?id=recXXX or {"id":"recXXX"}' })
      };
    }

    // Validate Airtable record ID format
    if (!/^rec[a-zA-Z0-9]{10,20}$/.test(ticketId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid ticket ID format' })
      };
    }

    console.log('Deleting ticket:', ticketId);

    // Delete from Airtable
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TICKETS_TABLE)}/${ticketId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`
        }
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable delete error:', errorData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to delete ticket',
          details: errorData
        })
      };
    }

    const result = await response.json();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deleted: true,
        id: result.id,
        message: 'Ticket deleted successfully'
      })
    };

  } catch (error) {
    console.error('Error deleting ticket:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
