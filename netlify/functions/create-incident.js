// netlify/functions/create-incident.js
// v2.1 - Creates incident record, emails support, and triggers AI analysis

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; // Add this to Netlify env vars
const INCIDENTS_TABLE = 'Incidents';

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);

    // Validate required fields
    const required = ['title', 'severity', 'category', 'reportedBy', 'description'];
    for (const field of required) {
      if (!data[field]) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing required field: ${field}` })
        };
      }
    }

    // PRIORITY 1: Send email notification FIRST (most important)
    const emailSent = await sendNotificationEmail(data);
    console.log('Email notification sent:', emailSent);

    // PRIORITY 2: Trigger Make.com AI analysis webhook
    const webhookSent = await triggerMakeWebhook(data);
    console.log('Make.com webhook triggered:', webhookSent);

    // PRIORITY 3: Try to create Airtable record (nice to have)
    let airtableRecord = null;
    if (AIRTABLE_TOKEN && AIRTABLE_BASE_ID) {
      try {
        airtableRecord = await createAirtableRecord(data);
        console.log('Airtable record created:', airtableRecord?.id);
      } catch (airtableError) {
        console.error('Airtable error (non-fatal):', airtableError);
        // Don't fail the request - email was sent
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        incidentId: airtableRecord?.id || 'email-only',
        emailSent: emailSent,
        aiAnalysisTriggered: webhookSent,
        message: 'Issue reported successfully. Support has been notified and AI analysis initiated.'
      })
    };

  } catch (error) {
    console.error('Error creating incident:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error: ' + error.message })
    };
  }
};

// Send email notification to support@resultantai.com
async function sendNotificationEmail(incident) {
  if (!RESEND_API_KEY) {
    console.log('No RESEND_API_KEY - skipping email');
    return false;
  }

  const severityEmoji = {
    'Critical': '🚨',
    'High': '⚠️',
    'Medium': '📋',
    'Low': 'ℹ️'
  };

  const emoji = severityEmoji[incident.severity] || '📋';
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const emailBody = `
${emoji} NEW BEAVER PUMICE INCIDENT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TITLE: ${incident.title}
SEVERITY: ${incident.severity}
CATEGORY: ${incident.category}
REPORTED BY: ${incident.reportedBy}
TIME: ${timestamp}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DESCRIPTION:
${incident.description}

${incident.affectedTickets ? `AFFECTED TICKETS: ${incident.affectedTickets}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Portal: https://beaver-pumice-portal.netlify.app
Dashboard: https://beaver-pumice-portal.netlify.app/incidents-dashboard.html

This is an automated message from Beaver Pumice System Health Dashboard.
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Beaver Pumice Alerts <tickets@beaverpumice.com>',
        to: ['support@resultantai.com'],
        subject: `${emoji} [BEAVER PUMICE] [${incident.severity}] ${incident.title}`,
        text: emailBody
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Failed to send notification email:', err);
    return false;
  }
}

// Create record in Airtable Incidents table
async function createAirtableRecord(data) {
  const fields = {
    'Title': data.title,
    'Status': 'Open',
    'Severity': data.severity,
    'Category': data.category,
    'Reported By': data.reportedBy,
    'Reported Date': new Date().toISOString().split('T')[0],
    'Description': data.description
  };

  if (data.affectedTickets) {
    fields['Notes'] = `Affected tickets: ${data.affectedTickets}`;
  }

  const response = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(INCIDENTS_TABLE)}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(JSON.stringify(errorData));
  }

  return await response.json();
}

// Trigger Make.com webhook for AI analysis
async function triggerMakeWebhook(incident) {
  if (!MAKE_WEBHOOK_URL) {
    console.log('No MAKE_WEBHOOK_URL - skipping AI analysis');
    return false;
  }

  try {
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: incident.title,
        severity: incident.severity,
        category: incident.category,
        reportedBy: incident.reportedBy,
        description: incident.description,
        affectedTickets: incident.affectedTickets || '',
        timestamp: new Date().toISOString(),
        source: 'beaver-pumice-portal'
      })
    });

    return response.ok;
  } catch (err) {
    console.error('Failed to trigger Make.com webhook:', err);
    return false;
  }
}
