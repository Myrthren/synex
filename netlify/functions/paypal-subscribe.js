// netlify/functions/paypal-subscribe.js
// Verifies a PayPal subscription and updates the user's Supabase profile.

const PAYPAL_API = 'https://api-m.paypal.com'

const PLAN_MAP = {
  'P-966838243K2590535NGWHOMA': 'starter',
  'P-7J432863NB1172348NGWHPSQ': 'pro',
  'P-9RK9748717749020UNGWHQCQ': 'business',
}

async function getPayPalToken(clientId, secret) {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

async function verifySubscription(token, subscriptionId, expectedPlanId) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`PayPal subscription lookup failed: ${res.status}`)
  const sub = await res.json()

  if (sub.status !== 'ACTIVE') throw new Error(`Subscription not active (status: ${sub.status})`)
  if (sub.plan_id !== expectedPlanId) throw new Error(`Plan ID mismatch: expected ${expectedPlanId}, got ${sub.plan_id}`)

  return sub
}

async function updateSupabaseProfile(supabaseUrl, serviceRoleKey, userId, plan, subscriptionId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      plan,
      paypal_subscription_id: subscriptionId,
      active_tools: ['replyai'],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase update failed: ${res.status} — ${text}`)
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { subscriptionId, planId, userId } = body

  if (!subscriptionId || !planId || !userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing subscriptionId, planId, or userId' }) }
  }

  const plan = PLAN_MAP[planId]
  if (!plan) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown plan ID' }) }
  }

  const clientId = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_SECRET
  const supabaseUrl = 'https://rlinpjipyumrlswxesfm.supabase.co'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!clientId || !secret || !serviceRoleKey) {
    console.error('Missing env vars')
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) }
  }

  try {
    const token = await getPayPalToken(clientId, secret)
    await verifySubscription(token, subscriptionId, planId)
    await updateSupabaseProfile(supabaseUrl, serviceRoleKey, userId, plan, subscriptionId)

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, plan }),
    }
  } catch (err) {
    console.error('paypal-subscribe error:', err.message)
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: err.message }),
    }
  }
}
