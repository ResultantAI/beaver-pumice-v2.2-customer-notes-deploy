// POST /api/customers/import - Bulk imports customers to Airtable

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
  const CUSTOMERS_TABLE_ID = process.env.AIRTABLE_CUSTOMERS_TABLE_ID || 'tblAQKBdGWHeLz1WO';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable configuration' }) };
  }

  try {
    const { customers, skipDuplicates = true } = JSON.parse(event.body);

    if (!Array.isArray(customers) || customers.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No customers provided' }) };
    }

    if (customers.length > 100) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Maximum 100 customers per import' }) };
    }

    let existingNames = new Set();

    // Fetch existing customer names if skipDuplicates is true
    if (skipDuplicates) {
      let offset = null;
      do {
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}?fields%5B%5D=Customer%20Name${offset ? `&offset=${offset}` : ''}`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch existing customers: ${response.status}`);
        }

        const data = await response.json();
        data.records.forEach(record => {
          const name = record.fields['Customer Name'];
          if (name) existingNames.add(name.toLowerCase().trim());
        });
        offset = data.offset;
      } while (offset);
    }

    // Filter out duplicates
    const newCustomers = skipDuplicates 
      ? customers.filter(c => c.name && !existingNames.has(c.name.toLowerCase().trim()))
      : customers.filter(c => c.name);

    if (newCustomers.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, imported: 0, skipped: customers.length, message: 'All customers already exist' })
      };
    }

    const results = { imported: 0, failed: 0, errors: [] };

    // Process in batches of 10 (Airtable limit)
    for (let i = 0; i < newCustomers.length; i += 10) {
      const batch = newCustomers.slice(i, i + 10);
      
      const records = batch.map(customer => {
        const fields = { 'Customer Name': customer.name.trim() };

        if (customer.email) fields['Email'] = customer.email.trim();
        if (customer.phone) fields['Phone'] = customer.phone.trim();
        if (customer.address1) fields['Address1'] = customer.address1.trim();
        if (customer.city) fields['City'] = customer.city.trim();
        if (customer.state) fields['State'] = customer.state.trim();
        if (customer.zip) fields['Zip'] = customer.zip.trim();
        
        if (customer.priceYard !== null && customer.priceYard !== undefined && customer.priceYard !== '') {
          const priceYard = parseFloat(customer.priceYard);
          if (!isNaN(priceYard)) fields['Price Yard'] = priceYard;
        }
        if (customer.priceTon !== null && customer.priceTon !== undefined && customer.priceTon !== '') {
          const priceTon = parseFloat(customer.priceTon);
          if (!isNaN(priceTon)) fields['Price Ton'] = priceTon;
        }

        return { fields };
      });

      try {
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ records })
        });

        if (!response.ok) {
          const errorData = await response.json();
          results.failed += batch.length;
          results.errors.push(`Batch ${Math.floor(i/10) + 1}: ${errorData.error?.message || 'Unknown error'}`);
        } else {
          const data = await response.json();
          results.imported += data.records.length;
        }
      } catch (batchError) {
        results.failed += batch.length;
        results.errors.push(`Batch ${Math.floor(i/10) + 1}: ${batchError.message}`);
      }

      // Delay between batches to avoid rate limiting
      if (i + 10 < newCustomers.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        imported: results.imported,
        failed: results.failed,
        skipped: customers.length - newCustomers.length,
        errors: results.errors.length > 0 ? results.errors : undefined,
        message: `Imported ${results.imported} customers${results.failed > 0 ? `, ${results.failed} failed` : ''}${customers.length - newCustomers.length > 0 ? `, ${customers.length - newCustomers.length} duplicates skipped` : ''}`
      })
    };

  } catch (error) {
    console.error('Error importing customers:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
