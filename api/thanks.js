// Сторінка «Дякуємо» для WayForPay + Meta Pixel Purchase
// Env-змінні (Vercel → Settings → Environment Variables):
//   WFP_MERCHANT_ACCOUNT  - merchantAccount з кабінету WayForPay
//   WFP_SECRET_KEY        - SecretKey з кабінету WayForPay
//   TICKET_PRICE          - ціна квитка (за замовчуванням 250)
const crypto = require('crypto');

const PIXEL_ID = '2169090437150978'; // Pixel Gesheft winter 2026
const TICKET_PRICE = Number(process.env.TICKET_PRICE) || 250; // ціна в одному місці

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// WayForPay може прислати form-urlencoded або JSON (інколи JSON лежить у єдиному ключі)
function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = Object.fromEntries(new URLSearchParams(b)); }
  }
  if (!b || typeof b !== 'object') return {};
  const keys = Object.keys(b);
  if (keys.length === 1 && keys[0].trim().startsWith('{')) {
    try { return JSON.parse(keys[0]); } catch {}
  }
  return b;
}

async function checkStatus(orderReference) {
  const merchantAccount = process.env.WFP_MERCHANT_ACCOUNT;
  const secret = process.env.WFP_SECRET_KEY;
  if (!merchantAccount || !secret) return null;
  const merchantSignature = crypto
    .createHmac('md5', secret)
    .update(`${merchantAccount};${orderReference}`)
    .digest('hex');
  const r = await fetch('https://api.wayforpay.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionType: 'CHECK_STATUS',
      merchantAccount,
      orderReference,
      merchantSignature,
      apiVersion: 1,
    }),
  });
  return r.json();
}

function page({ approved, orderReference, amount, currency }) {
  const numItems = Math.max(1, Math.round(amount / TICKET_PRICE));
  const pixel = `
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${PIXEL_ID}');
fbq('track','PageView');
${approved ? `
(function(){
  var order=${JSON.stringify(String(orderReference))};
  var key='gesheft_purchase_'+order;
  try{ if(localStorage.getItem(key)) return; }catch(e){}
  fbq('track','Purchase',{value:${Number(amount)},currency:'UAH',num_items:${numItems}},{eventID:order});
  try{ localStorage.setItem(key,'1'); }catch(e){}
})();` : ''}
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"/></noscript>`;

  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${approved ? 'Дякуємо!' : 'Оплата не пройшла'}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f4;color:#1a1a1a;text-align:center;padding:24px}
  .card{max-width:420px;background:#fff;border-radius:16px;padding:40px 28px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  h1{font-size:26px;margin:0 0 12px} p{font-size:17px;line-height:1.5;margin:0;color:#555}
  .ok{font-size:48px;margin-bottom:12px}
</style>
${pixel}
</head><body><div class="card">
${approved
  ? `<div class="ok">🎟️</div><h1>Квиток оплачено. Дякуємо!</h1><p>Замовлення ${esc(orderReference)}. До зустрічі на Гешефті!</p>`
  : `<h1>Оплата не пройшла</h1><p>Спробуйте ще раз за посиланням на оплату або зверніться до організаторів.</p>`}
</div></body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const body = req.method === 'POST' ? parseBody(req) : {};
  const orderReference = body.orderReference;
  let approved = false;
  let amount = Number(body.amount) || 0;
  let currency = body.currency;

  if (orderReference) {
    try {
      const checked = await checkStatus(orderReference);
      if (checked) {
        // Є SecretKey: довіряємо тільки відповіді WayForPay
        approved = checked.transactionStatus === 'Approved';
        amount = Number(checked.amount) || amount;
        currency = checked.currency || currency;
      } else {
        // Без SecretKey - fallback на дані з POST (менш надійно)
        approved = body.transactionStatus === 'Approved';
      }
    } catch (e) {
      console.error('CHECK_STATUS error', e);
      approved = false;
    }
  }

  // 200 завжди, щоб людина не бачила помилку
  res.status(200).send(page({ approved, orderReference, amount, currency }));
};
