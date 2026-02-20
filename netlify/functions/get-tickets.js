// netlify/functions/get-tickets.js
// Fetches all tickets from Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
    let allRecords = [];
    let offset = null;

    // Fetch all records with pagination
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TICKETS_TABLE)}?pageSize=100&sort[0][field]=Ticket%20Number&sort[0][direction]=desc${offset ? `&offset=${offset}` : ''}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to fetch tickets');
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);

    // Transform to frontend format
    const tickets = allRecords.map(record => ({
      id: record.id,
      airtableId: record.id,
      number: record.fields['Ticket Number'] || 0,
      customer: record.fields['Customer Name'] ? record.fields['Customer Name'][0] : '',
      customerId: record.fields['Customer'] ? record.fields['Customer'][0] : null,
      carrier: record.fields['Hauling For Name'] ? record.fields['Hauling For Name'][0] : '',
      carrierId: record.fields['Hauling For'] ? record.fields['Hauling For'][0] : null,
      truck: record.fields['Truck Text'] || (record.fields['Truck Name'] ? record.fields['Truck Name'][0] : ''),
      truckId: record.fields['Truck'] ? record.fields['Truck'][0] : null,
      product: record.fields['Product Name'] ? record.fields['Product Name'][0] : '',
      productId: record.fields['Product'] ? record.fields['Product'][0] : null,
      gross: record.fields['Gross Weight lbs'] || 0,
      tare: record.fields['Tare Weight lbs'] || 0,
      netLbs: record.fields['Net Weight lbs'] || 0,
      netTons: record.fields['Net Tons'] || 0,
      netYards: record.fields['Net Yards'] || 0,
      po: record.fields['PO Number'] || '',
      note: record.fields['Ticket Note'] || '',
      customerNote: record.fields['Customer Note'] || '',
      status: record.fields['Status'] || 'Open',
      exportedToQB: record.fields['QB Exported'] || false,
      exportDate: record.fields['QB Export Date'] || null,
      freightCost: record.fields['Freight Cost'] || 0,
      freightCharge: record.fields['Freight Charge'] || 0,
      freightMargin: record.fields['Freight Margin'] || 0,
      date: record.fields['Created'] ? new Date(record.fields['Created']).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : '',
      printUrl: `https://beaver-pumice-ticket-viewer.netlify.app/?id=${record.id}`
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, tickets })
    };

  } catch (error) {
    console.error('Error fetching tickets:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
