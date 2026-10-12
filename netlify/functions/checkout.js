// Creates a Stripe Checkout Session. Prices are defined HERE (server-side)
// so customers can't change them from the browser.
const CATALOG = {
  'Golden Hour Platforms': 8900,
  'Golden Affair Heels': 9500,
  'Rose Glow Platforms': 8500,
  'Silver Starlight Heels': 9000,
  'Pearl Soiree Platforms': 9900,
  'Mirror Gold Platforms': 8900,
  'Rose Baguette Platforms': 9500,
  'Aurora Crystal Platforms': 9500,
  'Champagne Baguette Platforms': 9500,
  'Chrome Silver Platforms': 8900,
  'Silver Ribbon Platforms': 9200,
  'Amber Wings Platforms': 9800,
  'Rose Wings Stilettos': 9800,
  'Moonlit Wings Stilettos': 9800,
  'Golden Wings Stilettos': 9800,
  'Rose Ribbon Platforms': 9500,
  'Diamond Ribbon Heels': 9500,
  'Stardust Stilettos': 9200,
  'Grand Ribbon Platforms': 10500,
  'Gilded Ribbon Platforms': 9500,
  'Silver Mosaic Platforms': 10500,
  'Rose Mosaic Platforms': 10500,
  'Champagne Mosaic Platforms': 10500,
  'Gold Mosaic Platforms': 10500
};
const CURRENCY = 'eur';
const FREE_SHIPPING_FROM = 15000; // cents
const SHIPPING_FEE = 690;         // cents
// code -> discount. freeShipping:true also waives the shipping fee.
const PROMOS = {
  ROMA10: { percent: 10 },
  HADIDI100: { percent: 100, freeShipping: true }
};
const ALLOWED_SIZES = ['36', '37', '38', '39', '40'];

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

async function stripe(path, params, key) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Stripe error');
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad request.' }); }

  // Promo check used by the bag page (codes are never sent to the browser)
  if (body.action === 'promo') {
    const found = PROMOS[String(body.code || '').trim().toUpperCase()];
    return found ? json(200, { ok: true, percent: found.percent, freeShipping: !!found.freeShipping }) : json(404, { error: 'invalid' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'Payments are not configured yet.' });

  try {
    const { items, promo, customer } = body;
    if (!Array.isArray(items) || !items.length) return json(400, { error: 'Your bag is empty.' });
    if (!customer || !/^\S+@\S+\.\S+$/.test(customer.email || '')) return json(400, { error: 'Please enter a valid email.' });

    const p = new URLSearchParams();
    p.append('mode', 'payment');
    p.append('customer_email', customer.email);

    let subtotal = 0;
    items.forEach((it, i) => {
      const unit = CATALOG[it.name];
      const qty = Math.min(10, Math.max(1, parseInt(it.qty, 10) || 1));
      if (!unit || !ALLOWED_SIZES.includes(String(it.size))) throw new Error('Invalid item in bag.');
      subtotal += unit * qty;
      p.append(`line_items[${i}][quantity]`, String(qty));
      p.append(`line_items[${i}][price_data][currency]`, CURRENCY);
      p.append(`line_items[${i}][price_data][unit_amount]`, String(unit));
      p.append(`line_items[${i}][price_data][product_data][name]`, `${it.name} — Size ${it.size}`);
    });

    const promoInfo = PROMOS[String(promo || '').trim().toUpperCase()];
    const percent = promoInfo ? promoInfo.percent : 0;
    let discounted = subtotal;
    if (percent) {
      const coupon = await stripe('coupons', new URLSearchParams({ percent_off: String(percent), duration: 'once' }), key);
      p.append('discounts[0][coupon]', coupon.id);
      discounted = Math.round(subtotal * (100 - percent) / 100);
    }

    const shipping = (discounted >= FREE_SHIPPING_FROM || (promoInfo && promoInfo.freeShipping)) ? 0 : SHIPPING_FEE;
    p.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    p.append('shipping_options[0][shipping_rate_data][display_name]', shipping ? 'Standard shipping' : 'Free shipping');
    p.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shipping));
    p.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', CURRENCY);

    // Shipping details are saved on the order so you can see them in the Stripe dashboard.
    const c = customer;
    p.append('metadata[name]', String(c.name || '').slice(0, 200));
    p.append('metadata[phone]', String(c.phone || '').slice(0, 50));
    p.append('metadata[address]', [c.address, c.postal, c.city, c.country].filter(Boolean).join(', ').slice(0, 480));
    p.append('metadata[note]', String(c.note || '').slice(0, 480));

    const origin = event.headers.origin || process.env.URL || '';
    p.append('success_url', origin + '/success.html');
    p.append('cancel_url', origin + '/checkout.html');

    const session = await stripe('checkout/sessions', p, key);
    return json(200, { url: session.url });
  } catch (e) {
    return json(400, { error: e.message });
  }
};
