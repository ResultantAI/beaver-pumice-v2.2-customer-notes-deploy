// POST /api/products/update - Updates a product in Airtable

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';
  const PRODUCTS_TABLE = process.env.AIRTABLE_PRODUCTS_TABLE_ID || 'Products';

  if (!AIRTABLE_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Airtable token' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const { id, name, lbsPerYard, priceYard, priceTon, qbCode } = data;

    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID is required' }) };
    }

    // Build fields object - use standard Airtable field names
    const fields = {};
    
    if (name !== undefined) {
      fields['Product Name'] = name;
    }
    
    if (lbsPerYard !== undefined) {
      const weight = parseFloat(lbsPerYard);
      if (!isNaN(weight)) {
        fields['Weight Per Cubic Yard'] = weight;
      }
    }
    
    if (priceYard !== undefined && priceYard !== null) {
      const price = parseFloat(priceYard);
      if (!isNaN(price)) {
        fields['Base Price Yard'] = price;
      }
    }
    
    if (priceTon !== undefined && priceTon !== null) {
      const price = parseFloat(priceTon);
      if (!isNaN(price)) {
        fields['Base Price Ton'] = price;
      }
    }
    
    if (qbCode !== undefined) {
      fields['QB Item Code'] = qbCode;
    }

    console.log('Updating product:', id, 'with fields:', JSON.stringify(fields));

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(PRODUCTS_TABLE)}/${id}`;
    
    let response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    // If failed due to unknown field, retry with only known fields
    if (!response.ok) {
      const errorData = await response.json();
      const errorMsg = errorData.error?.message || '';
      
      if (response.status === 422 && errorMsg.includes('Unknown field')) {
        console.log('Unknown field error, retrying with base fields only');
        
        // Retry with just the basic fields
        const baseFields = {};
        if (fields['Product Name']) baseFields['Product Name'] = fields['Product Name'];
        if (fields['Weight Per Cubic Yard']) baseFields['Weight Per Cubic Yard'] = fields['Weight Per Cubic Yard'];
        
        response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: baseFields })
        });
        
        if (response.ok) {
          const record = await response.json();
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              warning: 'Some fields (pricing, QB code) not saved. Please add these fields to Airtable first.',
              product: {
                id: record.id,
                name: record.fields['Product Name'] || '',
                lbsPerYard: record.fields['Weight Per Cubic Yard'] || 0
              }
            })
          };
        }
      }
      
      if (response.status === 404) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Product not found' }) };
      }
      throw new Error(errorData.error?.message || `Airtable API error: ${response.status}`);
    }

    const record = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        product: {
          id: record.id,
          name: record.fields['Product Name'] || record.fields['Product'] || '',
          lbsPerYard: record.fields['Weight Per Cubic Yard'] || 0,
          priceYard: record.fields['Base Price Yard'] || null,
          priceTon: record.fields['Base Price Ton'] || null,
          qbCode: record.fields['QB Item Code'] || ''
        }
      })
    };

  } catch (error) {
    console.error('Error updating product:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
