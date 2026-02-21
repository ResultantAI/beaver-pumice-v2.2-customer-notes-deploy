// netlify/functions/get-users.js
// Fetches users from Airtable User_Logins table
// v70 - Dynamic user loading

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
  
  // User_Logins table ID - you may need to update this
  const USERS_TABLE = 'User_Logins';

  if (!AIRTABLE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Airtable token not configured' })
    };
  }

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch users');
    }

    const data = await response.json();

    // Map Airtable records to user objects
    const users = data.records.map(record => {
      const fields = record.fields;
      const name = fields['User Name'] || '';
      const role = (fields['Role'] || 'Operator').toLowerCase();
      const pin = fields['PIN'] || '0000';
      
      // Determine icon and label based on role
      let icon, label;
      switch(role) {
        case 'admin':
          icon = '👑';
          label = 'Administrator';
          break;
        case 'finance':
          icon = '💰';
          label = 'Finance';
          break;
        default:
          icon = '👷';
          label = 'Operator';
      }
      
      return {
        id: record.id,
        name: name,
        role: role,
        pin: String(pin).padStart(4, '0'), // Ensure 4 digits
        icon: icon,
        label: label,
        // Permission flags from Airtable
        canCreateTickets: fields['Can Create Tickets'] || false,
        canViewTickets: fields['Can View Tickets'] || false,
        canEditTickets: fields['Can Edit Tickets in Hold'] || false,
        canCloseTickets: fields['Can Close Tickets'] || false,
        canAccessReports: fields['Can Access Reports'] || false
      };
    }).filter(u => u.name); // Filter out empty records

    console.log(`Loaded ${users.length} users from Airtable`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, users })
    };

  } catch (error) {
    console.error('Error fetching users:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
