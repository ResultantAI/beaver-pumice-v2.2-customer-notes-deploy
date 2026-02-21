// netlify/functions/manage-pricing.js
// CRUD operations for customer and carrier pricing
// Supports all 7 billing scenarios

// Node 22+ has built-in fetch

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appZxvRMbFIHl63lH';

  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Airtable token not configured' })
    };
  }

  try {
    // Get path from rawUrl or event.path
    let path = '';
    if (event.rawUrl) {
      const url = new URL(event.rawUrl);
      path = url.pathname.replace('/api/pricing', '');
    } else {
      path = event.path.replace('/.netlify/functions/manage-pricing', '').replace('/api/pricing', '');
    }
    console.log('Pricing API - method:', event.httpMethod, 'path:', path, 'rawUrl:', event.rawUrl);
    
    // GET /api/pricing/summary - Get pricing summary with margins
    if (event.httpMethod === 'GET' && path === '/summary') {
      return await getPricingSummary(token, baseId, headers);
    }
    
    // GET /api/pricing/customers - Get all customer pricing
    if (event.httpMethod === 'GET' && (path === '/customers' || path === '')) {
      return await getCustomerPricing(token, baseId, headers);
    }
    
    // GET /api/pricing/carriers - Get all carrier rates
    if (event.httpMethod === 'GET' && path === '/carriers') {
      return await getCarrierRates(token, baseId, headers);
    }
    
    // GET /api/pricing/products - Get all product pricing
    if (event.httpMethod === 'GET' && path === '/products') {
      return await getProductPricing(token, baseId, headers);
    }
    
    // PATCH /api/pricing/customer/:id - Update customer pricing
    if (event.httpMethod === 'PATCH' && path.startsWith('/customer/')) {
      const customerId = path.replace('/customer/', '');
      const updates = JSON.parse(event.body);
      return await updateCustomerPricing(token, baseId, customerId, updates, headers);
    }
    
    // PATCH /api/pricing/carrier/:id - Update carrier rates
    if (event.httpMethod === 'PATCH' && path.startsWith('/carrier/')) {
      const carrierId = path.replace('/carrier/', '');
      const updates = JSON.parse(event.body);
      return await updateCarrierRates(token, baseId, carrierId, updates, headers);
    }
    
    // PATCH /api/pricing/product/:id - Update product pricing
    if (event.httpMethod === 'PATCH' && path.startsWith('/product/')) {
      const productId = path.replace('/product/', '');
      const updates = JSON.parse(event.body);
      return await updateProductPricing(token, baseId, productId, updates, headers);
    }
    
    // GET /api/pricing/customer-products/:customerId - Get allowed products for a customer
    if (event.httpMethod === 'GET' && path.startsWith('/customer-products/')) {
      const customerId = path.replace('/customer-products/', '');
      return await getCustomerProducts(token, baseId, customerId, headers);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint not found', path: path })
    };

  } catch (error) {
    console.error('Pricing API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// ==================== GET FUNCTIONS ====================

async function getCustomerPricing(token, baseId, headers) {
  console.log('=== GET CUSTOMER PRICING ===');
  const customers = [];
  let offset = null;

  try {
    do {
      let url = `https://api.airtable.com/v0/${baseId}/Customers?sort%5B0%5D%5Bfield%5D=Customer%20Name&sort%5B0%5D%5Bdirection%5D=asc`;
      if (offset) url += `&offset=${offset}`;

      console.log('Fetching customers from:', url);
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Customer fetch failed:', response.status, errorText);
        throw new Error(`Failed to fetch customers: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Got', data.records?.length, 'customer records');
      
      for (const record of data.records) {
        // Determine product rate and unit from Price Yard or Price Ton
        const priceYard = record.fields['Price Yard'] || null;
        const priceTon = record.fields['Price Ton'] || null;
        let productRate = null;
        let productUnit = 'Ton';
        
        if (priceYard) {
          productRate = priceYard;
          productUnit = 'Yard';
        } else if (priceTon) {
          productRate = priceTon;
          productUnit = 'Ton';
        }
        
        // Freight arrangement based on Freight Method
        const freightMethod = record.fields['Freight Method'] || '';
        let freightArrangement = 'Customer Direct';
        let freightUnit = null;
        
        if (freightMethod && freightMethod !== '') {
          freightArrangement = 'Beaver Arranged';
          if (freightMethod === 'per_ton') freightUnit = 'Ton';
          else if (freightMethod === 'per_yard') freightUnit = 'Yard';
          else if (freightMethod === 'flat') freightUnit = 'Flat';
          else if (freightMethod === 'delivered') freightUnit = 'Delivered';
        }
        
        customers.push({
          id: record.id,
          name: record.fields['Customer Name'] || '',
          address: record.fields['Bill To Address'] || record.fields['Address1'] || '',
          city: record.fields['Bill To City'] || record.fields['City'] || '',
          state: record.fields['Bill To State'] || record.fields['State'] || '',
          zip: record.fields['Bill To Zip'] || record.fields['Zip'] || '',
          contactEmail: record.fields['Bill To Email'] || record.fields['Contact Email'] || '',
          
          // Product billing (from Price Yard / Price Ton)
          productUnit: productUnit,
          productRate: productRate,
          
          // Freight arrangement (from Freight Method / Rate / Cost)
          freightArrangement: freightArrangement,
          freightUnit: freightUnit,
          freightRate: record.fields['Freight Rate'] || null,
          freightCost: record.fields['Freight Cost'] || null,
          
          // Allowed products (linked records)
          allowedProductIds: record.fields['Allowed Products'] || [],
          
          // Email settings
          emailReceipts: record.fields['Email Receipts'] || false,
          
          // QB settings
          qbCustomerName: record.fields['QB Customer Name'] || ''
        });
      }

      offset = data.offset;
    } while (offset);

    console.log('Total customers loaded:', customers.length);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        customers,
        count: customers.length
      })
    };
  } catch (error) {
    console.error('Error in getCustomerPricing:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message, customers: [] })
    };
  }
}

async function getCarrierRates(token, baseId, headers) {
  console.log('=== GET CARRIER RATES ===');
  const carriers = [];
  
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Carriers?sort%5B0%5D%5Bfield%5D=Carrier%20Name&sort%5B0%5D%5Bdirection%5D=asc`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Carrier fetch failed:', response.status, errorText);
      throw new Error(`Failed to fetch carriers: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Got', data.records?.length, 'carrier records');

    for (const record of data.records) {
      carriers.push({
        id: record.id,
        name: record.fields['Carrier Name'] || '',
        costType: record.fields['Cost Type'] || 'Per Ton',
        costPerTon: record.fields['Cost Per Ton'] || null,
        costPerYard: record.fields['Cost Per Yard'] || null,
        flatRatePerLoad: record.fields['Flat Rate Per Load'] || null
      });
    }

    console.log('Total carriers loaded:', carriers.length);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        carriers,
        count: carriers.length
      })
    };
  } catch (error) {
    console.error('Error in getCarrierRates:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message, carriers: [] })
    };
  }
}

async function getProductPricing(token, baseId, headers) {
  console.log('=== GET PRODUCT PRICING ===');
  const products = [];
  
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Products`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Product fetch failed:', response.status, errorText);
      throw new Error(`Failed to fetch products: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Got', data.records?.length, 'product records');

    for (const record of data.records) {
      products.push({
        id: record.id,
        name: record.fields['Product Name'] || '',
        weightPerYard: record.fields['Weight Per Cubic Yard'] || 1350,
        defaultPricePerTon: record.fields['Default Price Per Ton'] || null,
        defaultPricePerYard: record.fields['Default Price Per Yard'] || null,
        qbItemCode: record.fields['QB Item Code'] || ''
      });
    }

    console.log('Total products loaded:', products.length);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        products,
        count: products.length
      })
    };
  } catch (error) {
    console.error('Error in getProductPricing:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message, products: [] })
    };
  }
}

async function getCustomerProducts(token, baseId, customerId, headers) {
  // Fetch the customer to get their allowed products
  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/Customers/${customerId}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!response.ok) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Customer not found' })
    };
  }

  const customer = await response.json();
  const allowedProductIds = customer.fields['Allowed Products'] || [];
  
  // If no restrictions, return all products
  if (allowedProductIds.length === 0) {
    return await getProductPricing(token, baseId, headers);
  }
  
  // Fetch only the allowed products
  const products = [];
  for (const productId of allowedProductIds) {
    const prodResponse = await fetch(
      `https://api.airtable.com/v0/${baseId}/Products/${productId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (prodResponse.ok) {
      const prod = await prodResponse.json();
      products.push({
        id: prod.id,
        name: prod.fields['Product Name'] || '',
        weightPerYard: prod.fields['Weight Per Cubic Yard'] || 1350,
        defaultPricePerTon: prod.fields['Default Price Per Ton'] || null,
        defaultPricePerYard: prod.fields['Default Price Per Yard'] || null,
        qbItemCode: prod.fields['QB Item Code'] || ''
      });
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ 
      products,
      count: products.length,
      restricted: true
    })
  };
}

async function getPricingSummary(token, baseId, headers) {
  console.log('=== GET PRICING SUMMARY ===');
  console.log('Base ID:', baseId);
  
  try {
    // Get all pricing data for summary/margin analysis
    // Use Promise.allSettled to handle partial failures gracefully
    const [customerRes, carrierRes, productRes] = await Promise.allSettled([
      getCustomerPricing(token, baseId, headers),
      getCarrierRates(token, baseId, headers),
      getProductPricing(token, baseId, headers)
    ]);

    console.log('Customer response status:', customerRes.status);
    console.log('Carrier response status:', carrierRes.status);
    console.log('Product response status:', productRes.status);

    // Extract data with fallbacks for failed requests
    let customers = [];
    let carriers = [];
    let products = [];

    if (customerRes.status === 'fulfilled' && customerRes.value.statusCode === 200) {
      const customerData = JSON.parse(customerRes.value.body);
      customers = customerData.customers || [];
    } else {
      console.error('Customer fetch failed:', customerRes.reason || customerRes.value);
    }

    if (carrierRes.status === 'fulfilled' && carrierRes.value.statusCode === 200) {
      const carrierData = JSON.parse(carrierRes.value.body);
      carriers = carrierData.carriers || [];
    } else {
      console.error('Carrier fetch failed:', carrierRes.reason || carrierRes.value);
    }

    if (productRes.status === 'fulfilled' && productRes.value.statusCode === 200) {
      const productData = JSON.parse(productRes.value.body);
      products = productData.products || [];
    } else {
      console.error('Product fetch failed:', productRes.reason || productRes.value);
    }

    console.log('Customers loaded:', customers.length);
    console.log('Carriers loaded:', carriers.length);
    console.log('Products loaded:', products.length);

    // Calculate summary stats
    const customersWithPricing = customers.filter(c => c.productRate).length;
    const customersWithFreight = customers.filter(c => c.freightArrangement === 'Beaver Arranged').length;
    const customersWithEmail = customers.filter(c => c.emailReceipts).length;
    const customersWithProductRestrictions = customers.filter(c => c.allowedProductIds && c.allowedProductIds.length > 0).length;
    const carriersWithRates = carriers.filter(c => c.costPerTon || c.costPerYard || c.flatRatePerLoad).length;
    const productsWithPricing = products.filter(p => p.defaultPricePerTon || p.defaultPricePerYard).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        summary: {
          totalCustomers: customers.length,
          customersWithPricing,
          customersWithFreight,
          customersWithEmail,
          customersWithProductRestrictions,
          totalCarriers: carriers.length,
          carriersWithRates,
          totalProducts: products.length,
          productsWithPricing
        },
        customers,
        carriers,
        products
      })
    };
  } catch (error) {
    console.error('Error in getPricingSummary:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load pricing summary: ' + error.message })
    };
  }
}

// ==================== UPDATE FUNCTIONS ====================

async function updateCustomerPricing(token, baseId, customerId, updates, headers) {
  const fields = {};
  
  // Product billing
  if (updates.productUnit !== undefined) fields['Product Unit'] = updates.productUnit;
  if (updates.productRate !== undefined) fields['Product Rate'] = updates.productRate;
  
  // Freight arrangement
  if (updates.freightArrangement !== undefined) fields['Freight Arrangement'] = updates.freightArrangement;
  if (updates.freightUnit !== undefined) fields['Freight Unit'] = updates.freightUnit;
  if (updates.freightRate !== undefined) fields['Freight Rate'] = updates.freightRate;
  
  // Allowed products
  if (updates.allowedProductIds !== undefined) fields['Allowed Products'] = updates.allowedProductIds;
  
  // Email settings
  if (updates.emailReceipts !== undefined) fields['Email Receipts'] = updates.emailReceipts;
  if (updates.contactEmail !== undefined) fields['Contact Email'] = updates.contactEmail;
  
  // QB settings
  if (updates.qbCustomerName !== undefined) fields['QB Customer Name'] = updates.qbCustomerName;

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/Customers/${customerId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update customer: ${error}`);
  }

  const data = await response.json();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      customer: {
        id: data.id,
        name: data.fields['Customer Name'],
        productUnit: data.fields['Product Unit'],
        productRate: data.fields['Product Rate'],
        freightArrangement: data.fields['Freight Arrangement'],
        freightUnit: data.fields['Freight Unit'],
        freightRate: data.fields['Freight Rate'],
        allowedProductIds: data.fields['Allowed Products'] || [],
        emailReceipts: data.fields['Email Receipts'],
        contactEmail: data.fields['Contact Email']
      }
    })
  };
}

async function updateCarrierRates(token, baseId, carrierId, updates, headers) {
  const fields = {};
  
  if (updates.costType !== undefined) fields['Cost Type'] = updates.costType;
  if (updates.costPerTon !== undefined) fields['Cost Per Ton'] = updates.costPerTon;
  if (updates.costPerYard !== undefined) fields['Cost Per Yard'] = updates.costPerYard;
  if (updates.flatRatePerLoad !== undefined) fields['Flat Rate Per Load'] = updates.flatRatePerLoad;

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/Carriers/${carrierId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update carrier: ${error}`);
  }

  const data = await response.json();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      carrier: {
        id: data.id,
        name: data.fields['Carrier Name'],
        costType: data.fields['Cost Type'],
        costPerTon: data.fields['Cost Per Ton'],
        costPerYard: data.fields['Cost Per Yard'],
        flatRatePerLoad: data.fields['Flat Rate Per Load']
      }
    })
  };
}

async function updateProductPricing(token, baseId, productId, updates, headers) {
  const fields = {};
  
  if (updates.defaultPricePerTon !== undefined) fields['Default Price Per Ton'] = updates.defaultPricePerTon;
  if (updates.defaultPricePerYard !== undefined) fields['Default Price Per Yard'] = updates.defaultPricePerYard;
  if (updates.qbItemCode !== undefined) fields['QB Item Code'] = updates.qbItemCode;

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/Products/${productId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update product: ${error}`);
  }

  const data = await response.json();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      product: {
        id: data.id,
        name: data.fields['Product Name'],
        defaultPricePerTon: data.fields['Default Price Per Ton'],
        defaultPricePerYard: data.fields['Default Price Per Yard'],
        qbItemCode: data.fields['QB Item Code']
      }
    })
  };
}
