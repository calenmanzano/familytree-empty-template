// Shared date helpers, used by both the website and the Express API.
//
// Accepted input (case-insensitive, commas and "st/nd/rd/th" optional):
//   12 May 1948      12th May, 1948     12-May-1948
//   May 12 1948      May 12, 1948       Sept. 3rd 1921
//   May 1948         1948
//   1948-05-12       1948-05            (stored format)
//
// Everything is stored as YYYY, YYYY-MM or YYYY-MM-DD so dates sort correctly.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FamilyDates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const HINT = 'Use a date like 12 May 1948, May 12 1948, May 1948 or 1948';

  // "May", "may", "Sept.", "september" -> 1-12, or 0 if not a month
  function monthNumber(word) {
    let w = word.toLowerCase().replace(/\.$/, '');
    if (w === 'sept') w = 'sep';
    if (w.length < 3) return 0;
    const i = MONTHS.findIndex((m) => m.startsWith(w));
    return i + 1;
  }

  function daysIn(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  const pad = (n) => String(n).padStart(2, '0');

  function build(year, month, day) {
    if (!month) return { value: String(year) };
    if (month < 1 || month > 12) return { error: 'That month does not exist. ' + HINT };
    if (!day) return { value: `${year}-${pad(month)}` };
    if (day < 1 || day > daysIn(year, month)) {
      return { error: `${SHORT[month - 1]} ${year} doesn't have a day ${day}.` };
    }
    return { value: `${year}-${pad(month)}-${pad(day)}` };
  }

  // Returns { value: 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY' | null } or { error: 'message' }.
  // An empty input gives { value: null }.
  function parse(input) {
    if (input === undefined || input === null) return { value: null };
    const raw = String(input).trim();
    if (!raw) return { value: null };

    let m = raw.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
    if (m) return build(Number(m[1]), m[2] && Number(m[2]), m[3] && Number(m[3]));

    // Turn "12-May-1948" or "May 12, 1948" into space-separated words.
    const s = raw.replace(/[,\-/]/g, ' ').replace(/\s+/g, ' ').trim();
    const ord = '(?:st|nd|rd|th)?';

    // 12 May 1948
    m = s.match(new RegExp(`^(\\d{1,2})${ord} ([a-z.]+) (\\d{4})$`, 'i'));
    if (m) {
      const month = monthNumber(m[2]);
      if (month) return build(Number(m[3]), month, Number(m[1]));
    }

    // May 12 1948
    m = s.match(new RegExp(`^([a-z.]+) (\\d{1,2})${ord} (\\d{4})$`, 'i'));
    if (m) {
      const month = monthNumber(m[1]);
      if (month) return build(Number(m[3]), month, Number(m[2]));
    }

    // May 1948
    m = s.match(/^([a-z.]+) (\d{4})$/i);
    if (m) {
      const month = monthNumber(m[1]);
      if (month) return build(Number(m[2]), month, null);
    }

    if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(raw)) {
      return { error: `"${raw}" could be read two ways. Write the month as a word, like 12 May 1948.` };
    }
    return { error: `"${raw}" isn't a date we recognise. ${HINT}.` };
  }

  // 'YYYY-MM-DD' -> '12 May 1948', 'YYYY-MM' -> 'May 1948', 'YYYY' -> '1948'
  function format(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    if (d) return `${Number(d)} ${SHORT[Number(m) - 1]} ${y}`;
    if (m) return `${SHORT[Number(m) - 1]} ${y}`;
    return y;
  }

  return { parse, format, HINT };
});
