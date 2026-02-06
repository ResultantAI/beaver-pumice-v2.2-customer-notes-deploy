// netlify/functions/send-ticket-email.js
// Send ticket receipt emails via Resend API
// FREE tier: 3,000 emails/month, 100/day

// Node 22+ has built-in fetch

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Support both old and new parameter formats
    const body = JSON.parse(event.body);
    const ticket = body.ticket || body.ticketData;
    const customer = body.customer || {};
    const sendTo = body.sendTo || body.recipientEmail;

    // Validate required fields
    if (!ticket || !sendTo) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing ticket data or recipient email' })
      };
    }

    // Validate email format (basic check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sendTo)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email address format' })
      };
    }

    // Sanitize email (prevent header injection)
    const cleanEmail = sendTo.trim().toLowerCase().substring(0, 254);
    if (cleanEmail.includes('\n') || cleanEmail.includes('\r')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email address' })
      };
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL || 'tickets@beaverpumice.com';
    const fromName = process.env.FROM_NAME || 'Beaver Pumice';

    if (!resendKey) {
      console.error('RESEND_API_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Email service not configured. Add RESEND_API_KEY to Netlify.' })
      };
    }

    // Build email HTML
    const ticketNumber = ticket.ticketNumber || ticket['Ticket Number'] || 'N/A';
    const emailHtml = buildTicketEmailHtml(ticket, customer);
    const emailText = buildTicketEmailText(ticket, customer);

    // Send via Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [cleanEmail],
        subject: `Ticket #${ticketNumber} - ${ticket.productName || ticket['Product Name'] || 'Pumice'}`,
        html: emailHtml,
        text: emailText
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: result.message || 'Failed to send email',
          details: result
        })
      };
    }

    console.log('Email sent successfully:', result.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        messageId: result.id,
        to: cleanEmail
      })
    };

  } catch (error) {
    console.error('Email send error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function buildTicketEmailHtml(ticket, customer) {
  // Handle both camelCase and Airtable field names
  const ticketNumber = ticket.ticketNumber || ticket['Ticket Number'] || 'N/A';
  const date = ticket.date || ticket['Date'];
  const time = ticket.time || ticket['Time'] || '';
  const customerName = customer?.name || ticket.customerName || ticket['Customer Name'] || 'N/A';
  const productName = ticket.productName || ticket['Product Name'] || 'N/A';
  const grossWeight = ticket.grossWeight || ticket['Gross Weight'] || 0;
  const tareWeight = ticket.tareWeight || ticket['Tare Weight'] || 0;
  const netWeight = ticket.netWeight || ticket['Net Weight'] || 0;
  const netTons = ticket.netTons || ticket['Net Tons'] || 0;
  const netYards = ticket.netYards || ticket['Net Yards'] || 0;
  const carrierName = ticket.carrierName || ticket['Carrier Name'] || '';
  const truckId = ticket.truckId || ticket['Truck ID'] || '';
  const notes = ticket.notes || ticket['Notes'] || '';

  const formattedDate = date ? new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'N/A';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket #${ticketNumber}</title>
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
              <span style="color: #1e293b; font-size: 24px; font-weight: bold;">Ticket #${ticketNumber}</span>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              
              <!-- Date/Time -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                <tr>
                  <td style="color: #64748b; font-size: 14px;">${formattedDate}</td>
                  <td align="right" style="color: #64748b; font-size: 14px;">${time}</td>
                </tr>
              </table>
              
              <!-- Customer Info -->
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Customer</h3>
                <p style="margin: 0; color: #1e293b; font-size: 18px; font-weight: 600;">${customerName}</p>
              </div>
              
              <!-- Product Info -->
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Product</h3>
                <p style="margin: 0; color: #1e293b; font-size: 18px; font-weight: 600;">${productName}</p>
              </div>
              
              <!-- Weight Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="33%" style="padding: 15px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Gross</div>
                    <div style="color: #1e293b; font-size: 20px; font-weight: bold;">${formatWeight(grossWeight)}</div>
                  </td>
                  <td width="5%"></td>
                  <td width="33%" style="padding: 15px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
                    <div style="color: #64748b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Tare</div>
                    <div style="color: #1e293b; font-size: 20px; font-weight: bold;">${formatWeight(tareWeight)}</div>
                  </td>
                  <td width="5%"></td>
                  <td width="33%" style="padding: 15px; background-color: #C9A227; border-radius: 8px; text-align: center;">
                    <div style="color: #1e293b; font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Net</div>
                    <div style="color: #1e293b; font-size: 20px; font-weight: bold;">${formatWeight(netWeight)}</div>
                  </td>
                </tr>
              </table>
              
              <!-- Net Tons/Yards -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px; border: 2px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td width="50%" style="padding: 20px; text-align: center; border-right: 1px solid #e2e8f0;">
                    <div style="color: #64748b; font-size: 14px; margin-bottom: 5px;">Net Tons</div>
                    <div style="color: #1e293b; font-size: 28px; font-weight: bold;">${Number(netTons).toFixed(2)}</div>
                  </td>
                  <td width="50%" style="padding: 20px; text-align: center;">
                    <div style="color: #64748b; font-size: 14px; margin-bottom: 5px;">Net Yards</div>
                    <div style="color: #1e293b; font-size: 28px; font-weight: bold;">${Number(netYards).toFixed(2)}</div>
                  </td>
                </tr>
              </table>
              
              <!-- Carrier/Truck Info -->
              ${carrierName || truckId ? `
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Hauling</h3>
                <p style="margin: 0; color: #1e293b; font-size: 16px;">
                  ${carrierName || 'N/A'}
                  ${truckId ? ` • Truck: ${truckId}` : ''}
                </p>
              </div>
              ` : ''}
              
              <!-- Notes -->
              ${notes ? `
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Notes</h3>
                <p style="margin: 0; color: #78350f; font-size: 14px;">${notes}</p>
              </div>
              ` : ''}
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #64748b; font-size: 12px;">
                Beaver Pumice LLC<br>
                Questions? Contact us at your convenience.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function buildTicketEmailText(ticket, customer) {
  const ticketNumber = ticket.ticketNumber || ticket['Ticket Number'] || 'N/A';
  const date = ticket.date || ticket['Date'] || 'N/A';
  const time = ticket.time || ticket['Time'] || '';
  const customerName = customer?.name || ticket.customerName || ticket['Customer Name'] || 'N/A';
  const productName = ticket.productName || ticket['Product Name'] || 'N/A';
  const grossWeight = ticket.grossWeight || ticket['Gross Weight'] || 0;
  const tareWeight = ticket.tareWeight || ticket['Tare Weight'] || 0;
  const netWeight = ticket.netWeight || ticket['Net Weight'] || 0;
  const netTons = ticket.netTons || ticket['Net Tons'] || 0;
  const netYards = ticket.netYards || ticket['Net Yards'] || 0;
  const carrierName = ticket.carrierName || ticket['Carrier Name'] || '';
  const truckId = ticket.truckId || ticket['Truck ID'] || '';
  const notes = ticket.notes || ticket['Notes'] || '';

  return `
BEAVER PUMICE - Ticket Receipt

Ticket #${ticketNumber}
Date: ${date}
Time: ${time}

Customer: ${customerName}
Product: ${productName}

WEIGHTS
Gross: ${formatWeight(grossWeight)}
Tare: ${formatWeight(tareWeight)}
Net: ${formatWeight(netWeight)}

Net Tons: ${Number(netTons).toFixed(2)}
Net Yards: ${Number(netYards).toFixed(2)}

${carrierName ? `Carrier: ${carrierName}` : ''}
${truckId ? `Truck: ${truckId}` : ''}
${notes ? `Notes: ${notes}` : ''}

---
Beaver Pumice LLC
  `.trim();
}

function formatWeight(weight) {
  if (!weight && weight !== 0) return '0 lbs';
  return Number(weight).toLocaleString() + ' lbs';
}
