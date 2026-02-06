// netlify/functions/update-ticket.js
// Updates an existing ticket in Airtable
// v2.2 - Added auto-email on close

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
  const CUSTOMERS_TABLE = 'Customers';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'tickets@beaverpumice.com';
  const FROM_NAME = process.env.FROM_NAME || 'Beaver Pumice';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Airtable token not configured' })
    };
  }

  try {
    const updateData = JSON.parse(event.body);
    
    console.log('=== UPDATE TICKET DEBUG ===');
    console.log('Raw body:', event.body);
    console.log('Parsed updateData:', JSON.stringify(updateData, null, 2));
    
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
    
    // Validate record ID
    if (!isValidRecordId(updateData.id)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid ticket ID format' })
      };
    }

    // Build Airtable fields for update - CORE FIELDS
    const fields = {};
    
    // OPTIONAL FIELDS that may not exist in Airtable
    const optionalFields = {};
    
    // v2.2: Track if status is changing to Closed for auto-email
    let statusChangingToClosed = false;
    let previousStatus = updateData.previousStatus || null;

    // Always update weights if provided
    if (updateData.gross !== undefined) {
      fields['Gross Weight lbs'] = sanitizeNumber(updateData.gross);
    }
    if (updateData.tare !== undefined) {
      fields['Tare Weight lbs'] = sanitizeNumber(updateData.tare);
    }

    // Update linked records only if they have valid Airtable IDs
    if (isValidRecordId(updateData.customerId)) {
      fields['Customer'] = [updateData.customerId];
    }
    
    if (isValidRecordId(updateData.carrierId)) {
      fields['Hauling For'] = [updateData.carrierId];
    }
    
    // Truck is now a text field - OPTIONAL (may not exist)
    if (updateData.truck !== undefined) {
      optionalFields['Truck Text'] = sanitize(updateData.truck);
    }
    // Also support linked record if provided (backwards compatibility)
    if (isValidRecordId(updateData.truckId)) {
      fields['Truck'] = [updateData.truckId];
    }
    
    // Freight fields (optional - for when Beaver Pumice arranges trucking)
    if (updateData.freightCost !== undefined) {
      optionalFields['Freight Cost'] = parseFloat(updateData.freightCost) || 0;
    }
    if (updateData.freightCharge !== undefined) {
      optionalFields['Freight Charge'] = parseFloat(updateData.freightCharge) || 0;
    }
    // Calculate and store freight margin
    if (updateData.freightCharge !== undefined || updateData.freightCost !== undefined) {
      const charge = parseFloat(updateData.freightCharge) || 0;
      const cost = parseFloat(updateData.freightCost) || 0;
      optionalFields['Freight Margin'] = charge - cost;
    }
    
    if (isValidRecordId(updateData.productId)) {
      fields['Product'] = [updateData.productId];
    }
    
    // Update text fields (allow empty strings to clear)
    if (updateData.po !== undefined) {
      fields['PO Number'] = sanitize(updateData.po);
    }
    
    if (updateData.note !== undefined) {
      fields['Ticket Note'] = sanitize(updateData.note);
    }

    // Handle Status updates - check both direct and nested formats
    const newStatus = updateData.status || updateData.fields?.Status;
    if (newStatus) {
      // Validate status value (whitelist approach)
      const validStatuses = ['Open', 'Hold', 'Closed', 'Void'];
      if (validStatuses.includes(newStatus)) {
        fields['Status'] = newStatus;
        // v2.2: Track if changing to Closed
        if (newStatus === 'Closed' && previousStatus !== 'Closed') {
          statusChangingToClosed = true;
        }
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
        };
      }
    }

    // If only updating status and no other fields, make sure we have something to update
    const allFields = { ...fields, ...optionalFields };
    if (Object.keys(allFields).length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No valid fields to update' })
      };
    }

    console.log('=== AIRTABLE UPDATE ===');
    console.log('Record ID:', updateData.id);
    console.log('Core fields:', JSON.stringify(fields, null, 2));
    console.log('Optional fields:', JSON.stringify(optionalFields, null, 2));

    // Try update with all fields first
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TICKETS_TABLE)}/${updateData.id}`;
    
    let response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: allFields })
    });

    // If failed due to unknown field or invalid status option, retry
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable error:', JSON.stringify(errorData, null, 2));
      
      const errorMsg = errorData.error?.message || '';
      
      // Check if error is about unknown field - retry without optional fields
      if (response.status === 422 && (
        errorMsg.includes('Unknown field') || 
        errorMsg.includes('Truck Text') ||
        errorMsg.includes('Insufficient permissions to create new select option')
      )) {
        console.log('Retrying without optional fields due to:', errorMsg);
        
        // If Status caused the issue (missing "Hold" option), remove it and notify
        if (errorMsg.includes('select option') && fields['Status']) {
          const attemptedStatus = fields['Status'];
          delete fields['Status'];
          console.log('Removed Status field - option may not exist in Airtable:', attemptedStatus);
          
          // Also retry without optional fields
          response = await fetch(url, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
          });
          
          if (response.ok) {
            const record = await response.json();
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                warning: `Status "${attemptedStatus}" not available in Airtable. Please add it as an option in the Status field.`,
                id: record.id,
                ticketNumber: record.fields['Ticket Number'],
                message: 'Ticket updated (status change skipped)'
              })
            };
          }
        } else {
          // Retry without optional fields
          response = await fetch(url, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
          });
        }
        
        if (!response.ok) {
          const retryError = await response.json();
          console.error('Retry also failed:', retryError);
          return {
            statusCode: response.status,
            headers,
            body: JSON.stringify({ 
              error: retryError.error?.message || 'Failed to update ticket',
              details: retryError
            })
          };
        }
      } else {
        // Extract meaningful error message from Airtable response
        let errorMessage = 'Failed to update ticket in Airtable';
        if (errorData.error) {
          if (errorData.error.message) {
            errorMessage = errorData.error.message;
          } else if (typeof errorData.error === 'string') {
            errorMessage = errorData.error;
          }
        }
        
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ 
            error: errorMessage,
            details: errorData
          })
        };
      }
    }

    const record = await response.json();
    
    // v2.2: Auto-email on close
    let emailSent = false;
    let emailError = null;
    let emailTo = null;
    
    if (statusChangingToClosed && RESEND_API_KEY) {
      console.log('=== AUTO-EMAIL ON CLOSE ===');

      // FIX: Fetch complete ticket record with all formula fields
      // PATCH response doesn't always include formula fields like Net Yards
      const fullTicketResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TICKETS_TABLE)}/${updateData.id}`,
        { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
      );

      if (!fullTicketResponse.ok) {
        console.error('Failed to fetch complete ticket record for email');
        emailError = 'Failed to fetch ticket data';
      } else {
        const fullTicketRecord = await fullTicketResponse.json();
        console.log('Full ticket record fetched:', JSON.stringify(fullTicketRecord.fields, null, 2));

        // Get customer ID from the updated ticket
        const customerId = fullTicketRecord.fields['Customer'] ? fullTicketRecord.fields['Customer'][0] : null;

        if (customerId) {
          try {
            // Fetch customer to check auto-email setting
            const customerResponse = await fetch(
              `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(CUSTOMERS_TABLE)}/${customerId}`,
              { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
            );

            if (customerResponse.ok) {
              const customerData = await customerResponse.json();
              const customerEmail = customerData.fields['Email'];
              const autoEmail = customerData.fields['Auto Email Ticket'];
              const customerName = customerData.fields['Customer Name'];

              console.log(`Customer: ${customerName}, email: ${customerEmail}, autoEmail: ${autoEmail}`);

              if (autoEmail && customerEmail) {
                emailTo = customerEmail;

                // Build ticket data for email - using fullTicketRecord to get all formula fields
                const ticketData = {
                  ticketNumber: fullTicketRecord.fields['Ticket Number'],
                  date: fullTicketRecord.fields['Created'] || new Date().toISOString(),
                  customerName: customerName,
                  productName: fullTicketRecord.fields['Product Name'] ? fullTicketRecord.fields['Product Name'][0] : 'N/A',
                  carrierName: fullTicketRecord.fields['Hauling For Name'] ? fullTicketRecord.fields['Hauling For Name'][0] : '',
                  truckId: fullTicketRecord.fields['Truck Text'] || (fullTicketRecord.fields['Truck Name'] ? fullTicketRecord.fields['Truck Name'][0] : ''),
                  grossWeight: fullTicketRecord.fields['Gross Weight lbs'] || 0,
                  tareWeight: fullTicketRecord.fields['Tare Weight lbs'] || 0,
                  netWeight: fullTicketRecord.fields['Net Weight lbs'] || 0,
                  netTons: fullTicketRecord.fields['Net Tons'] || 0,
                  netYards: fullTicketRecord.fields['Net Yards'] || 0,  // FIX: Now reads from complete record
                  notes: fullTicketRecord.fields['Ticket Note'] || ''
                };

                console.log('Ticket data for email:', JSON.stringify(ticketData, null, 2));
              
                // Send email via Resend
                const emailHtml = buildAutoEmailHtml(ticketData);

                const emailResponse = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    from: `${FROM_NAME} <${FROM_EMAIL}>`,
                    to: [customerEmail],
                    subject: `Ticket #${ticketData.ticketNumber} - ${ticketData.productName}`,
                    html: emailHtml
                  })
                });

                if (emailResponse.ok) {
                  emailSent = true;
                  console.log(`Auto-email sent to ${customerEmail} for ticket #${ticketData.ticketNumber}`);
                } else {
                  const emailErr = await emailResponse.json();
                  emailError = emailErr.message || 'Failed to send email';
                  console.error('Email send failed:', emailErr);
                }
              }
            }
          } catch (emailErr) {
            console.error('Error in auto-email process:', emailErr);
            emailError = emailErr.message;
          }
        }
      }
    }
    
    // Return success with updated ticket number
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: record.id,
        ticketNumber: record.fields['Ticket Number'],
        printUrl: `https://beaver-pumice-ticket-viewer.netlify.app/?id=${record.id}`,
        message: 'Ticket updated successfully',
        emailSent: emailSent,
        emailTo: emailTo,
        emailError: emailError
      })
    };

  } catch (error) {
    console.error('Error updating ticket:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// v2.2: Helper function to build auto-email HTML
function buildAutoEmailHtml(ticket) {
  const formatWeight = (w) => Number(w || 0).toLocaleString() + ' lbs';
  const formatDate = (d) => {
    try {
      return new Date(d).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch { return 'N/A'; }
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #1e293b; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #C9A227; font-size: 28px; font-weight: bold;">BEAVER PUMICE</h1>
              <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">Ticket Receipt</p>
            </td>
          </tr>
          
          <!-- Ticket Number Banner -->
          <tr>
            <td style="background-color: #C9A227; padding: 20px; text-align: center;">
              <span style="color: #1e293b; font-size: 24px; font-weight: bold;">Ticket #${ticket.ticketNumber}</span>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              
              <!-- Date -->
              <p style="color: #64748b; font-size: 14px; margin: 0 0 20px 0;">${formatDate(ticket.date)}</p>
              
              <!-- Customer & Product -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="48%" style="background-color: #f8fafc; border-radius: 8px; padding: 15px;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Customer</div>
                    <div style="color: #1e293b; font-size: 16px; font-weight: 600;">${ticket.customerName}</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background-color: #f8fafc; border-radius: 8px; padding: 15px;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Product</div>
                    <div style="color: #1e293b; font-size: 16px; font-weight: 600;">${ticket.productName}</div>
                  </td>
                </tr>
              </table>
              
              <!-- Weight Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="30%" style="padding: 15px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Gross</div>
                    <div style="color: #1e293b; font-size: 18px; font-weight: bold;">${formatWeight(ticket.grossWeight)}</div>
                  </td>
                  <td width="5%"></td>
                  <td width="30%" style="padding: 15px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Tare</div>
                    <div style="color: #1e293b; font-size: 18px; font-weight: bold;">${formatWeight(ticket.tareWeight)}</div>
                  </td>
                  <td width="5%"></td>
                  <td width="30%" style="padding: 15px; background-color: #C9A227; border-radius: 8px; text-align: center;">
                    <div style="color: #1e293b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Net</div>
                    <div style="color: #1e293b; font-size: 18px; font-weight: bold;">${formatWeight(ticket.netWeight)}</div>
                  </td>
                </tr>
              </table>
              
              <!-- Net Tons/Yards -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px; border: 2px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td width="50%" style="padding: 20px; text-align: center; border-right: 1px solid #e2e8f0;">
                    <div style="color: #64748b; font-size: 14px; margin-bottom: 5px;">Net Tons</div>
                    <div style="color: #1e293b; font-size: 28px; font-weight: bold;">${Number(ticket.netTons || 0).toFixed(2)}</div>
                  </td>
                  <td width="50%" style="padding: 20px; text-align: center;">
                    <div style="color: #64748b; font-size: 14px; margin-bottom: 5px;">Net Yards</div>
                    <div style="color: #1e293b; font-size: 28px; font-weight: bold;">${Number(ticket.netYards || 0).toFixed(2)}</div>
                  </td>
                </tr>
              </table>
              
              ${ticket.carrierName || ticket.truckId ? `
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Hauling</div>
                <div style="color: #1e293b; font-size: 14px;">${ticket.carrierName || 'N/A'}${ticket.truckId ? ' • Truck: ' + ticket.truckId : ''}</div>
              </div>
              ` : ''}
              
              ${ticket.notes ? `
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 15px;">
                <div style="color: #92400e; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Notes</div>
                <div style="color: #78350f; font-size: 14px;">${ticket.notes}</div>
              </div>
              ` : ''}
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #64748b; font-size: 12px;">
                Beaver Pumice LLC • 92777 US-97, Chemult, OR 97731
              </p>
            </td>
          </tr>
          
        </table>
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 16px;">
          This is an automated message from the Beaver Pumice ticketing system.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
