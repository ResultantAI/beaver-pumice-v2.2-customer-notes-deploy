// netlify/functions/create-ticket.js
// Creates a new ticket in Airtable and returns the record ID for printing

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
  const TICKETS_TABLE = process.env.AIRTABLE_TICKETS_TABLE_ID || 'Tickets';

  // Enhanced environment variable check
  if (!AIRTABLE_TOKEN) {
    console.error('CRITICAL: AIRTABLE_TOKEN environment variable is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Airtable token not configured',
        help: 'Please set AIRTABLE_TOKEN in Netlify environment variables'
      })
    };
  }

  // Log configuration (without exposing full token)
  console.log('Config check:', {
    hasToken: !!AIRTABLE_TOKEN,
    tokenPrefix: AIRTABLE_TOKEN ? AIRTABLE_TOKEN.substring(0, 10) + '...' : 'MISSING',
    baseId: BASE_ID,
    table: TICKETS_TABLE
  });

  try {
    const ticketData = JSON.parse(event.body);
    
    // Input sanitization helper
    const sanitize = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.trim().substring(0, 500); // Limit length, trim whitespace
    };
    
    const sanitizeNumber = (num) => {
      const parsed = parseInt(num);
      return isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 999999)); // 0-999999 range
    };
    
    // Validate Airtable record ID format (starts with 'rec' + alphanumeric)
    const isValidRecordId = (id) => {
      return id && typeof id === 'string' && /^rec[a-zA-Z0-9]{10,20}$/.test(id);
    };
    
    // Build Airtable fields - CORE FIELDS ONLY (these must exist)
    const fields = {
      'Gross Weight lbs': sanitizeNumber(ticketData.gross),
      'Tare Weight lbs': sanitizeNumber(ticketData.tare),
    };

    // Add linked records only if they have valid Airtable IDs
    if (isValidRecordId(ticketData.customerId)) {
      fields['Customer'] = [ticketData.customerId];
    } else {
      console.warn('Customer ID validation failed:', ticketData.customerId);
    }
    
    if (isValidRecordId(ticketData.carrierId)) {
      fields['Hauling For'] = [ticketData.carrierId];
    } else {
      console.warn('Carrier ID validation failed:', ticketData.carrierId);
    }
    
    if (isValidRecordId(ticketData.productId)) {
      fields['Product'] = [ticketData.productId];
    } else {
      console.warn('Product ID validation failed:', ticketData.productId);
    }
    
    if (ticketData.po) {
      fields['PO Number'] = sanitize(ticketData.po);
    }
    
    if (ticketData.note) {
      fields['Ticket Note'] = sanitize(ticketData.note);
    }

    // OPTIONAL FIELDS - These may not exist in Airtable yet
    // We'll try with them first, then retry without if it fails
    const optionalFields = {};
    
    // Truck - save as text field (optional - may not exist)
    if (ticketData.truck) {
      optionalFields['Truck Text'] = sanitize(ticketData.truck);
    }
    
    // Customer Note (optional - may not exist)
    if (ticketData.customerNote) {
      optionalFields['Customer Note'] = sanitize(ticketData.customerNote);
    }
    
    // Freight fields (optional - for when Beaver Pumice arranges trucking)
    if (ticketData.freightCost && parseFloat(ticketData.freightCost) > 0) {
      optionalFields['Freight Cost'] = parseFloat(ticketData.freightCost);
    }
    if (ticketData.freightCharge && parseFloat(ticketData.freightCharge) > 0) {
      optionalFields['Freight Charge'] = parseFloat(ticketData.freightCharge);
    }
    // Freight Margin is calculated (Charge - Cost)
    if (ticketData.freightCharge && ticketData.freightCost) {
      const margin = parseFloat(ticketData.freightCharge) - parseFloat(ticketData.freightCost);
      if (margin !== 0) {
        optionalFields['Freight Margin'] = margin;
      }
    }
    
    // v73: Pumice Charge - calculated by frontend based on customer pricing
    // This ensures customer-specific rates are used instead of relying on Airtable formulas
    if (ticketData.pumiceCharge !== undefined && ticketData.pumiceCharge !== null) {
      const pumiceCharge = parseFloat(ticketData.pumiceCharge);
      if (!isNaN(pumiceCharge) && pumiceCharge >= 0) {
        optionalFields['Pumice Charge'] = pumiceCharge;
        console.log(`Setting Pumice Charge: $${pumiceCharge.toFixed(2)}`);
      }
    }
    
    // v73: Price Per Unit - for reference/debugging
    if (ticketData.pricePerUnit && parseFloat(ticketData.pricePerUnit) > 0) {
      optionalFields['Price Per Unit'] = parseFloat(ticketData.pricePerUnit);
    }
    
    // v73: Pricing Method used - for reference/debugging  
    if (ticketData.pricingMethod) {
      optionalFields['Pricing Method Used'] = ticketData.pricingMethod;
    }

    console.log('=== CREATE TICKET DEBUG ===');
    console.log('Raw input:', JSON.stringify(ticketData));
    console.log('Core fields:', JSON.stringify(fields));
    console.log('Optional fields:', JSON.stringify(optionalFields));

    // Create record in Airtable - try with all fields first
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TICKETS_TABLE)}`;
    console.log('Airtable URL:', url);
    
    let allFields = { ...fields, ...optionalFields };
    
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: allFields })
    });

    console.log('Airtable response status:', response.status);

    // If failed, check if it's due to unknown field - retry with core fields only
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable error response:', errorText);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { rawError: errorText };
      }
      
      const errorMsg = errorData.error?.message || errorText || '';
      
      // Check if error is about unknown field - retry without optional fields
      if (response.status === 422 && (errorMsg.includes('Unknown field') || errorMsg.includes('Truck Text') || errorMsg.includes('Customer Note'))) {
        console.log('Retrying without optional fields...');
        
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields })
        });
        
        if (!response.ok) {
          const retryError = await response.text();
          console.error('Retry also failed:', retryError);
          return {
            statusCode: response.status,
            headers,
            body: JSON.stringify({ 
              error: 'Failed to create ticket',
              details: retryError
            })
          };
        }
      } else {
        // Provide specific error messages
        let userMessage = 'Failed to create ticket in Airtable';
        if (response.status === 401) {
          userMessage = 'Airtable authentication failed - check API token';
        } else if (response.status === 403) {
          userMessage = 'Airtable permission denied - check token permissions';
        } else if (response.status === 404) {
          userMessage = 'Airtable table not found - check table name';
        } else if (response.status === 422) {
          userMessage = 'Invalid data sent to Airtable: ' + errorMsg;
        }
        
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ 
            error: userMessage,
            status: response.status,
            details: errorData,
            fieldsAttempted: Object.keys(allFields)
          })
        };
      }
    }

    const record = await response.json();
    console.log('Ticket created successfully:', record.id);
    
    // Return the record ID and ticket number for printing
    // printUrl uses relative path so it works on any deployment
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: record.id,
        ticketNumber: record.fields['Ticket Number'],
        printUrl: `/ticket-viewer.html?id=${record.id}`
      })
    };

  } catch (error) {
    console.error('Exception in create-ticket:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        type: 'exception',
        stack: error.stack
      })
    };
  }
};
