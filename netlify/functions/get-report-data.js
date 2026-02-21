// GET /api/reports/tickets - Fetches filtered ticket data for reports
// Supports filtering by date range, customer, carrier, product, status

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const params = event.queryStringParameters || {};
    
    // Parse filter parameters
    const filters = {
      startDate: params.startDate || null,      // ISO date string
      endDate: params.endDate || null,          // ISO date string
      customerId: params.customerId || null,    // Airtable record ID
      carrierId: params.carrierId || null,      // Airtable record ID
      productId: params.productId || null,      // Airtable record ID
      status: params.status || null,            // 'Open', 'Closed', 'Void'
      excludeVoid: params.excludeVoid !== 'false' // Default true
    };

    // Fetch ALL tickets from Airtable without formula filtering
    // This is more reliable - we'll filter in JavaScript
    let allRecords = [];
    let offset = null;

    do {
      let url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Tickets?pageSize=100&sort[0][field]=Ticket%20Number&sort[0][direction]=desc`;
      
      if (offset) {
        url += `&offset=${offset}`;
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `Airtable API error: ${response.status}`);
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);

    // Transform to report format
    let tickets = allRecords.map(record => {
      // Try multiple possible date field names
      const dateValue = record.fields['Created'] || record.fields['Date'] || record.fields['Ticket Date'] || '';
      
      return {
        id: record.id,
        number: record.fields['Ticket Number'] || 0,
        date: dateValue,
        customer: record.fields['Customer Name']?.[0] || '',
        customerId: record.fields['Customer']?.[0] || null,
        carrier: record.fields['Hauling For Name']?.[0] || '',
        carrierId: record.fields['Hauling For']?.[0] || null,
        product: record.fields['Product Name']?.[0] || '',
        productId: record.fields['Product']?.[0] || null,
        truck: record.fields['Truck Text'] || record.fields['Truck Name']?.[0] || '',
        tare: record.fields['Tare Weight lbs'] || 0,
        gross: record.fields['Gross Weight lbs'] || 0,
        netLbs: record.fields['Net Weight lbs'] || 0,
        netTons: record.fields['Net Tons'] || 0,
        netYards: record.fields['Net Yards'] || 0,
        po: record.fields['PO Number'] || '',
        note: record.fields['Ticket Note'] || '',
        status: record.fields['Status'] || 'Open',
        exportedToQB: record.fields['QB Exported'] || false
      };
    });

    // Apply date filtering in JavaScript (more reliable than Airtable formula)
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      startDate.setHours(0, 0, 0, 0);
      tickets = tickets.filter(t => {
        if (!t.date) return false;
        const ticketDate = new Date(t.date);
        return ticketDate >= startDate;
      });
    }
    
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      tickets = tickets.filter(t => {
        if (!t.date) return true; // Include tickets without dates
        const ticketDate = new Date(t.date);
        return ticketDate <= endDate;
      });
    }

    // Apply customer filter in JavaScript
    if (filters.customerId) {
      tickets = tickets.filter(t => t.customerId === filters.customerId);
    }

    // Apply carrier filter in JavaScript
    if (filters.carrierId) {
      tickets = tickets.filter(t => t.carrierId === filters.carrierId);
    }

    // Apply product filter in JavaScript
    if (filters.productId) {
      tickets = tickets.filter(t => t.productId === filters.productId);
    }

    // Apply status filter in JavaScript
    if (filters.status) {
      tickets = tickets.filter(t => t.status === filters.status);
    } else if (filters.excludeVoid) {
      tickets = tickets.filter(t => t.status !== 'Void');
    }

    // Calculate summary statistics
    const summary = {
      totalTickets: tickets.length,
      totalTons: tickets.reduce((sum, t) => sum + (t.netTons || 0), 0),
      totalYards: tickets.reduce((sum, t) => sum + (t.netYards || 0), 0),
      totalNetLbs: tickets.reduce((sum, t) => sum + (t.netLbs || 0), 0)
    };

    // Group by customer for reports
    const byCustomer = {};
    for (const ticket of tickets) {
      const custName = ticket.customer || 'Unknown';
      if (!byCustomer[custName]) {
        byCustomer[custName] = {
          customerId: ticket.customerId,
          tickets: [],
          totalTons: 0,
          totalYards: 0,
          ticketCount: 0
        };
      }
      byCustomer[custName].tickets.push(ticket);
      byCustomer[custName].totalTons += ticket.netTons || 0;
      byCustomer[custName].totalYards += ticket.netYards || 0;
      byCustomer[custName].ticketCount++;
    }

    // Group by product for reports
    const byProduct = {};
    for (const ticket of tickets) {
      const prodName = ticket.product || 'Unknown';
      if (!byProduct[prodName]) {
        byProduct[prodName] = {
          productId: ticket.productId,
          totalTons: 0,
          totalYards: 0,
          ticketCount: 0
        };
      }
      byProduct[prodName].totalTons += ticket.netTons || 0;
      byProduct[prodName].totalYards += ticket.netYards || 0;
      byProduct[prodName].ticketCount++;
    }

    // Group by carrier for reports
    const byCarrier = {};
    for (const ticket of tickets) {
      const carrierName = ticket.carrier || 'Unknown';
      if (!byCarrier[carrierName]) {
        byCarrier[carrierName] = {
          carrierId: ticket.carrierId,
          totalTons: 0,
          totalYards: 0,
          ticketCount: 0
        };
      }
      byCarrier[carrierName].totalTons += ticket.netTons || 0;
      byCarrier[carrierName].totalYards += ticket.netYards || 0;
      byCarrier[carrierName].ticketCount++;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        filters,
        summary,
        tickets,
        byCustomer,
        byProduct,
        byCarrier
      })
    };

  } catch (error) {
    console.error('Error fetching report data:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
