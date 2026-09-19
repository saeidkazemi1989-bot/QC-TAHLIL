// تقویم و ابزارهای تاریخ شمسی (jalali)
// الگوریتم تبدیل بر اساس پیاده‌سازی شناخته‌شده jalaali-js (MIT)

const div = (a, b) => Math.floor(a / b);
const mod = (a, b) => a - b * Math.floor(a / b);

const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** تبدیل اعداد به ارقام فارسی */
export function toFa(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** ارقام فارسی/عربی را به لاتین تبدیل می‌کند */
export function toEn(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function jalCal(jy) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  let leap;
  let n;

  if (jy < jp || jy >= breaks[bl - 1]) {
    // خارج از بازه تعریف‌شده؛ از تقریب ساده استفاده می‌کنیم
    jp = breaks[0];
  }
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

// شماره روز (Day Number) بر اساس epoch یونیکس: 1970-01-01 -> 2440588
// با استفاده از Date.UTC دقیق و برای تمام بازه‌های مورد نیاز معتبر است.
const DAY_EPOCH = 2440588;

function g2d(gy, gm, gd) {
  return Math.floor(Date.UTC(gy, gm - 1, gd) / 86400000) + DAY_EPOCH;
}

function d2g(jdn) {
  const d = new Date((jdn - DAY_EPOCH) * 86400000);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
}

/** شمسی -> روز جولین */
export function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** روز جولین -> شمسی */
export function d2j(jdn) {
  const { gy } = d2g(jdn);
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd;
  let jm;
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/** شمسی -> میلادی */
export function jalaliToGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

/** میلادی -> شمسی */
export function gregorianToJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

const pad = (n) => String(n).padStart(2, '0');

/** رشته استاندارد شمسی: 1405/05/26 */
export function formatJalali(jy, jm, jd) {
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/** نام ماه شمسی */
export function jalaliMonthName(jm) {
  return JALALI_MONTH_NAMES[jm - 1] || String(jm);
}

/**
 * تجزیه رشته تاریخ شمسی به اجزاء. فرمت‌های پشتیبانی‌شده:
 * 1405/05/26 | 1405-05-26 | 1405/5/6 | اشیاء Date اکسل
 */
export function parseJalali(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const j = gregorianToJalali(value.getFullYear(), value.getMonth() + 1, value.getDate());
    return { jy: j.jy, jm: j.jm, jd: j.jd, jdate: formatJalali(j.jy, j.jm, j.jd) };
  }
  if (typeof value === 'number') return null;
  const raw = toEn(String(value)).trim().replace(/\s+/g, '');
  const m = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 32) return null;
  return { jy, jm, jd, jdate: formatJalali(jy, jm, jd) };
}

/** روز هفته: 0 = شنبه ... 6 = جمعه */
export function jWeekday(jdate) {
  const p = parseJalali(jdate);
  if (!p) return null;
  const { gy, gm, gd } = jalaliToGregorian(p.jy, p.jm, p.jd);
  const dow = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0 = یکشنبه
  return (dow + 1) % 7; // شنبه = 0
}

/** شناسه هفته (شنبه‌آغاز) و برچسب آن */
export function jWeekInfo(jdate) {
  const p = parseJalali(jdate);
  if (!p) return null;
  const jdn = j2d(p.jy, p.jm, p.jd);
  const wd = jWeekday(jdate); // 0 = شنبه
  const sat = jdn - wd;
  // اولین شنبه سال شمسی
  const firstOfYear = j2d(p.jy, 1, 1);
  const firstWd = jWeekday(formatJalali(p.jy, 1, 1));
  const firstSat = firstOfYear + ((7 - firstWd) % 7);
  let weekNo = Math.floor((sat - firstSat) / 7) + 1;
  if (weekNo < 1) weekNo = 1;
  const dow = jWeekday(jdate);
  const startJdn = sat;
  const s = d2j(startJdn);
  return {
    weekNo,
    weekLabel: `هفته ${weekNo} ${p.jy}`,
    weekStart: formatJalali(s.jy, s.jm, s.jd),
    weekday: dow,
    weekdayName: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'][dow]
  };
}

/** برچسب‌های دوره‌ای برای نمودار روند */
export function periodLabels(jdate) {
  const p = parseJalali(jdate);
  if (!p) return null;
  const { jy, jm } = p;
  const quarter = Math.floor((jm - 1) / 3) + 1;
  const half = Math.floor((jm - 1) / 6) + 1;
  const quarterMonths = [
    ['فروردین', 'اردیبهشت', 'خرداد'],
    ['تیر', 'مرداد', 'شهریور'],
    ['مهر', 'آبان', 'آذر'],
    ['دی', 'بهمن', 'اسفند']
  ][quarter - 1];
  return {
    jdate,
    jyear: jy,
    jmonth: jm,
    jyearLabel: String(jy),
    jmonthLabel: `${jy}/${pad(jm)}`,
    jmonthNameLabel: `${jalaliMonthName(jm)} ${jy}`,
    jquarter: quarter,
    jquarterLabel: `${jy} / فصل ${quarter}`,
    jquarterNameLabel: `فصل ${quarter} ${jy} (${quarterMonths[0]} تا ${quarterMonths[2]})`,
    jhalf: half,
    jhalfLabel: `${jy} / نیم‌سال ${half}`,
    jhalfNameLabel: `نیم‌سال ${half} ${jy}`
  };
}

/** تولید بازه تاریخ‌های شمسی بین دو تاریخ (برای جدول تقویم) */
export function jalaliRange(fromJdate, toJdate) {
  const a = parseJalali(fromJdate);
  const b = parseJalali(toJdate);
  if (!a || !b) return [];
  const start = j2d(a.jy, a.jm, a.jd);
  const end = j2d(b.jy, b.jm, b.jd);
  const out = [];
  for (let d = start; d <= end; d += 1) {
    const j = d2j(d);
    out.push(formatJalali(j.jy, j.jm, j.jd));
  }
  return out;
}
