// netlify/functions/delete-tickets-no-customer.js
// Finds and deletes all tickets without a Customer assigned
// Admin-only operation

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    // GET - Find tickets without customers (preview)
    if (event.httpMethod === 'GET') {
      const ticketsWithoutCustomer = await findTicketsWithoutCustomer(token, baseId);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Found ${ticketsWithoutCustomer.length} tickets without a customer`,
          count: ticketsWithoutCustomer.length,
          tickets: ticketsWithoutCustomer.map(t => ({
            id: t.id,
            ticketNumber: t.fields['Ticket Number'],
            date: t.fields['Date'],
            product: t.fields['Product'] || 'Unknown',
            netTons: t.fields['Net Tons'] || 0
          })),
          instruction: 'To delete these tickets, send a DELETE request to this endpoint with confirm=true'
        })
      };
    }

    // DELETE - Actually delete the tickets
    if (event.httpMethod === 'DELETE') {
      const params = event.queryStringParameters || {};
      
      if (params.confirm !== 'true') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: 'Confirmation required. Add ?confirm=true to the URL to proceed.',
            warning: 'This action cannot be undone!'
          })
        };
      }

      const ticketsWithoutCustomer = await findTicketsWithoutCustomer(token, baseId);
      
      if (ticketsWithoutCustomer.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: 'No tickets without customers found',
            deleted: 0
          })
        };
      }

      // Delete in batches of 10 (Airtable limit)
      const deletedIds = [];
      const batchSize = 10;
      
      for (let i = 0; i < ticketsWithoutCustomer.length; i += batchSize) {
        const batch = ticketsWithoutCustomer.slice(i, i + batchSize);
        const idsParam = batch.map(t => `records[]=${t.id}`).join('&');
        
        const deleteResponse = await fetch(
          `https://api.airtable.com/v0/${baseId}/Tickets?${idsParam}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );

        if (!deleteResponse.ok) {
          const error = await deleteResponse.text();
          throw new Error(`Failed to delete batch: ${error}`);
        }

        const result = await deleteResponse.json();
        deletedIds.push(...result.records.map(r => r.id));
        
        // Brief pause between batches to avoid rate limiting
        if (i + batchSize < ticketsWithoutCustomer.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Successfully deleted ${deletedIds.length} tickets without customers`,
          deleted: deletedIds.length,
          deletedIds
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Delete tickets error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function findTicketsWithoutCustomer(token, baseId) {
  const ticketsWithoutCustomer = [];
  let offset = null;

  do {
    // Get all tickets and filter for those without Customer
    let url = `https://api.airtable.com/v0/${baseId}/Tickets?filterByFormula=OR({Customer}="",{Customer}=BLANK())`;
    if (offset) url += `&offset=${offset}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch tickets');
    }

    const data = await response.json();
    ticketsWithoutCustomer.push(...data.records);
    offset = data.offset;
  } while (offset);

  return ticketsWithoutCustomer;
}
