// netlify/functions/get-ticket.js
// Fetches a single ticket by ID for the ticket viewer

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Get record ID from query string
  const recordId = event.queryStringParameters?.id;

  if (!recordId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing ticket ID. Add ?id=RECORD_ID to the URL.' })
    };
  }

  // Validate record ID format (Airtable IDs start with 'rec')
  if (!recordId.startsWith('rec') || recordId.length < 10) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid ticket ID format.' })
    };
  }

  // Get credentials from environment variables
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const tableId = process.env.AIRTABLE_TICKETS_TABLE_ID || 'Tickets';
  const customersTable = process.env.AIRTABLE_CUSTOMERS_TABLE_ID || 'Customers';

  if (!token) {
    console.error('Missing AIRTABLE_TOKEN');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error.' })
    };
  }

  try {
    // Fetch ticket from Airtable
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${recordId}`;
    console.log('Fetching ticket:', recordId);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable error:', response.status, errorText);
      
      if (response.status === 404) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Ticket not found.' })
        };
      }
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    const fields = data.fields;

    // Helper to get lookup field (comes as array)
    const getLookup = (field) => {
      if (Array.isArray(field)) return field[0] || '';
      return field || '';
    };

    // Format date in Pacific Time with timezone label
    const dateStr = fields['Created'] 
      ? new Date(fields['Created']).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          month: 'numeric',
          day: 'numeric', 
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZoneName: 'short'
        })
      : '';

    // Get customer ID to fetch delivery address
    const customerId = fields['Customer'] ? fields['Customer'][0] : null;
    let deliveryAddress = fields['Delivery Location'] || '';
    
    // If no ticket-level delivery but we have a customer, fetch customer Ship To address
    if (!deliveryAddress && customerId) {
      try {
        const customerUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(customersTable)}/${customerId}`;
        const customerResponse = await fetch(customerUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (customerResponse.ok) {
          const customerData = await customerResponse.json();
          const cf = customerData.fields;
          
          // Use Ship To address for delivery location (fall back to Bill To if no Ship To)
          const addressParts = [];
          const shipToAddr = cf['Ship To Address'];
          const shipToCity = cf['Ship To City'];
          const shipToState = cf['Ship To State'];
          const shipToZip = cf['Ship To Zip'];
          
          // Check if Ship To address exists
          if (shipToAddr || shipToCity) {
            if (shipToAddr) addressParts.push(shipToAddr);
            const cityStateZip = [];
            if (shipToCity) cityStateZip.push(shipToCity);
            if (shipToState) cityStateZip.push(shipToState);
            if (shipToZip) cityStateZip.push(shipToZip);
            if (cityStateZip.length > 0) {
              addressParts.push(cityStateZip.join(', '));
            }
          } else {
            // Fall back to Bill To address (or legacy Address1)
            const billToAddr = cf['Bill To Address'] || cf['Address1'];
            if (billToAddr) addressParts.push(billToAddr);
            const cityStateZip = [];
            if (cf['Bill To City'] || cf['City']) cityStateZip.push(cf['Bill To City'] || cf['City']);
            if (cf['Bill To State'] || cf['State']) cityStateZip.push(cf['Bill To State'] || cf['State']);
            if (cf['Bill To Zip'] || cf['Zip']) cityStateZip.push(cf['Bill To Zip'] || cf['Zip']);
            if (cityStateZip.length > 0) {
              addressParts.push(cityStateZip.join(', '));
            }
          }
          
          deliveryAddress = addressParts.join(' • ') || '';
        }
      } catch (err) {
        console.log('Could not fetch customer address:', err.message);
      }
    }

    // Format ticket data for the viewer
    const ticket = {
      id: data.id,
      number: fields['Ticket Number'] || fields['Ticket #'] || '',
      date: dateStr,
      customer: getLookup(fields['Customer Name']),
      carrier: getLookup(fields['Hauling For Name']) || getLookup(fields['Carrier Name']),
      truck: fields['Truck Text'] || getLookup(fields['Truck Name']) || getLookup(fields['Truck ID']),
      product: getLookup(fields['Product Name']),
      po: fields['PO Number'] || '',
      note: fields['Ticket Note'] || '',
      customerNote: fields['Customer Note'] || '',
      gross: fields['Gross Weight lbs'] || 0,
      tare: fields['Tare Weight lbs'] || 0,
      net: fields['Net Weight lbs'] || 0,
      tons: fields['Net Tons'] || 0,
      yards: fields['Net Yards'] || 0,
      delivery: deliveryAddress
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticket })
    };

  } catch (error) {
    console.error('Error fetching ticket:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load ticket. Please try again.' })
    };
  }
};
