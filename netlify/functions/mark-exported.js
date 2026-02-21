// POST /api/tickets/mark-exported - Marks tickets as exported to QuickBooks

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const { ticketIds, exportDate, invoiceNumbers } = JSON.parse(event.body);

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No ticket IDs provided' }) };
    }

    const results = { updated: 0, failed: 0, errors: [] };
    const exportTimestamp = exportDate || new Date().toISOString();

    // Process in batches of 10 (Airtable limit)
    for (let i = 0; i < ticketIds.length; i += 10) {
      const batch = ticketIds.slice(i, i + 10);
      
      const records = batch.map((id, idx) => ({
        id,
        fields: {
          'QB Exported': true,
          'QB Export Date': exportTimestamp,
          'QB Invoice Number': invoiceNumbers?.[i + idx] || null
        }
      }));

      try {
        const response = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Tickets`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ records })
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          results.failed += batch.length;
          results.errors.push(errorData.error?.message || `Batch ${Math.floor(i/10) + 1} failed`);
        } else {
          const data = await response.json();
          results.updated += data.records.length;
        }
      } catch (batchError) {
        results.failed += batch.length;
        results.errors.push(batchError.message);
      }

      // Rate limiting delay
      if (i + 10 < ticketIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        ...results,
        message: `Marked ${results.updated} tickets as exported`
      })
    };

  } catch (error) {
    console.error('Error marking tickets as exported:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
