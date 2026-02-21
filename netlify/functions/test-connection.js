// GET /api/test - Tests Airtable connection and permissions

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

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const CUSTOMERS_TABLE_ID = process.env.AIRTABLE_CUSTOMERS_TABLE_ID;
  const PRODUCTS_TABLE_ID = process.env.AIRTABLE_PRODUCTS_TABLE_ID;
  const TICKETS_TABLE_ID = process.env.AIRTABLE_TICKETS_TABLE_ID || 'Tickets';

  const results = {
    timestamp: new Date().toISOString(),
    environment: {
      hasToken: !!AIRTABLE_TOKEN,
      tokenPrefix: AIRTABLE_TOKEN ? AIRTABLE_TOKEN.substring(0, 10) + '...' : 'MISSING',
      baseId: AIRTABLE_BASE_ID || 'MISSING',
      customersTableId: CUSTOMERS_TABLE_ID || 'MISSING',
      productsTableId: PRODUCTS_TABLE_ID || 'NOT SET',
      ticketsTableId: TICKETS_TABLE_ID || 'NOT SET'
    },
    tests: {}
  };

  // Test 1: Read from Customers table
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}?maxRecords=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      results.tests.customersRead = {
        status: 'PASS',
        message: `Can read Customers table (${data.records.length} record(s) returned)`,
        sampleFields: data.records[0] ? Object.keys(data.records[0].fields) : []
      };
    } else {
      const error = await response.json();
      results.tests.customersRead = {
        status: 'FAIL',
        message: error.error?.message || `HTTP ${response.status}`,
        hint: response.status === 404 ? 'Table ID may be wrong' : 'Check token permissions'
      };
    }
  } catch (err) {
    results.tests.customersRead = { status: 'ERROR', message: err.message };
  }

  // Test 2: Read from Tickets table (CRITICAL for ticket creation)
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TICKETS_TABLE_ID)}?maxRecords=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      results.tests.ticketsRead = {
        status: 'PASS',
        message: `Can read Tickets table (${data.records.length} record(s) returned)`,
        sampleFields: data.records[0] ? Object.keys(data.records[0].fields) : [],
        tableAccess: 'OK - can create tickets'
      };
    } else {
      const error = await response.json();
      results.tests.ticketsRead = {
        status: 'FAIL',
        message: error.error?.message || `HTTP ${response.status}`,
        hint: 'This will prevent ticket creation! Check Tickets table exists and token has access.',
        critical: true
      };
    }
  } catch (err) {
    results.tests.ticketsRead = { status: 'ERROR', message: err.message, critical: true };
  }

  // Test 3: Write test (create then delete a test record)
  try {
    const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: { 'Customer Name': '__TEST_RECORD_DELETE_ME__' }
      })
    });

    if (createResponse.ok) {
      const created = await createResponse.json();
      
      // Try to delete it
      const deleteUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}/${created.id}`;
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
      });

      if (deleteResponse.ok) {
        results.tests.customersWrite = {
          status: 'PASS',
          message: 'Can create and delete records (write permission confirmed)'
        };
      } else {
        results.tests.customersWrite = {
          status: 'PARTIAL',
          message: 'Can create but not delete records',
          recordToDelete: created.id
        };
      }
    } else {
      const error = await createResponse.json();
      results.tests.customersWrite = {
        status: 'FAIL',
        message: error.error?.message || `HTTP ${createResponse.status}`,
        hint: 'Token needs data.records:write scope'
      };
    }
  } catch (err) {
    results.tests.customersWrite = { status: 'ERROR', message: err.message };
  }

  // Test 4: Products table (if configured)
  if (PRODUCTS_TABLE_ID) {
    try {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PRODUCTS_TABLE_ID}?maxRecords=5`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        results.tests.productsRead = {
          status: 'PASS',
          message: `Can read Products table (${data.records.length} record(s))`,
          products: data.records.map(r => ({
            id: r.id,
            name: r.fields['Product'] || r.fields['Name'] || r.fields['Product Name'],
            weight: r.fields['Lbs per Yard'] || r.fields['Weight'] || r.fields['Lbs/Yard']
          }))
        };
      } else {
        const error = await response.json();
        results.tests.productsRead = {
          status: 'FAIL',
          message: error.error?.message || `HTTP ${response.status}`
        };
      }
    } catch (err) {
      results.tests.productsRead = { status: 'ERROR', message: err.message };
    }
  }

  // Summary
  const allPassed = Object.values(results.tests).every(t => t.status === 'PASS');
  const criticalFailed = Object.values(results.tests).some(t => t.critical && t.status !== 'PASS');
  results.success = allPassed;
  results.criticalFailure = criticalFailed;
  results.summary = allPassed 
    ? 'ALL TESTS PASSED ✓' 
    : criticalFailed 
      ? 'CRITICAL FAILURE - Ticket creation will not work'
      : 'SOME TESTS FAILED - See details above';

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(results, null, 2)
  };
};
