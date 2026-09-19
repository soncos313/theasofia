// Put this file at: netlify/functions/skicka.mjs (in your project root, next to package.json)
//
// It receives both forms, checks the member password on the server,
// validates the input and forwards it to your Google Sheet.
//
// Secrets are NOT written here. Set these in Netlify (Environment variables):
//   MEMBER_PASSWORD  the shared password for the member form
//   SHEETS_URL       the Apps Script web app URL (ends with /exec)
//   SHEETS_SECRET    the same text as SECRET in the Apps Script

import { timingSafeEqual } from 'node:crypto';

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value, max = 300) => String(value ?? '').trim().slice(0, max);

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function phoneOk(v) {
  const digits = v.replace(/\D/g, '');
  return /^[\d\s()+-]+$/.test(v) && digits.length >= 7 && digits.length <= 15;
}

// Swedish postal code: 5 digits, with or without a space ("223 62")
const postcodeOk = (v) => /^\d{5}$/.test(v.replace(/\s/g, ''));

// Personnummer: 10 or 12 digits, checked with the Luhn algorithm to catch typos.
function personnummerOk(v) {
  if (!/^[\d\s+-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return false;
  const ten = digits.slice(-10);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(ten[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function passwordOk(given) {
  const expected = (process.env.MEMBER_PASSWORD || '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function toSheet(tab, values) {
  try {
    const res = await fetch(process.env.SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: process.env.SHEETS_SECRET, tab, values }),
      redirect: 'follow',
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return reply({ ok: false, error: 'server' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: 'server' }, 400);
  }

  // Spam trap: real people never fill in the hidden field.
  if (clean(body.website)) return reply({ ok: true });

  // ---- Public form (home page) ----
  if (body.kind === 'kontakt') {
    const fullname = clean(body.fullname, 200);
    const email = clean(body.email, 200);
    const street = clean(body.street, 200);
    const postcode = clean(body.postcode, 10);
    const city = clean(body.city, 100);
    const source = clean(body.source, 300);

    if (!fullname || !email || !street || !postcode || !city || !source) {
      return reply({ ok: false, error: 'missing' }, 400);
    }
    if (!emailOk(email)) return reply({ ok: false, error: 'email' }, 400);
    if (!postcodeOk(postcode)) return reply({ ok: false, error: 'postcode' }, 400);

    const saved = await toSheet('Kontakt', [fullname, email, street, postcode, city, source]);
    return saved ? reply({ ok: true }) : reply({ ok: false, error: 'server' }, 502);
  }

  // ---- Member form (/medlem): password checked here, on the server ----
  if (body.kind === 'losenord' || body.kind === 'medlem') {
    // If the variable is missing, the function cannot see it: report a server error, not "wrong password".
    if (!(process.env.MEMBER_PASSWORD || '').trim()) {
      return reply({ ok: false, error: 'server' }, 500);
    }
    if (!passwordOk(clean(body.password, 200))) {
      // Debug aid: logs only lengths, never the passwords. Visible only in your Netlify function logs.
      console.log(
        'Password mismatch. Stored length:',
        (process.env.MEMBER_PASSWORD || '').trim().length,
        'Typed length:',
        clean(body.password, 200).length
      );
      await wait(1000); // slows down guessing
      return reply({ ok: false, error: 'password' }, 401);
    }
    if (body.kind === 'losenord') return reply({ ok: true });

    const fullname = clean(body.fullname, 200);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);
    const personnummer = clean(body.personnummer, 20);
    const street = clean(body.street, 200);
    const postcode = clean(body.postcode, 10);
    const city = clean(body.city, 100);

    if (!fullname || !email || !phone || !personnummer || !street || !postcode || !city) {
      return reply({ ok: false, error: 'missing' }, 400);
    }
    if (!emailOk(email)) return reply({ ok: false, error: 'email' }, 400);
    if (!phoneOk(phone)) return reply({ ok: false, error: 'phone' }, 400);
    if (!personnummerOk(personnummer)) return reply({ ok: false, error: 'personnummer' }, 400);
    if (!postcodeOk(postcode)) return reply({ ok: false, error: 'postcode' }, 400);

    const saved = await toSheet('Medlemmar', [
      fullname,
      email,
      phone,
      personnummer,
      street,
      postcode,
      city,
    ]);
    return saved ? reply({ ok: true }) : reply({ ok: false, error: 'server' }, 502);
  }

  return reply({ ok: false, error: 'server' }, 400);
};