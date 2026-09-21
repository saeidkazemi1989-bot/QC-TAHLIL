# ابزارهای تست رابط کاربری

نیاز: `npm install` در این پوشه (فقط jsdom). پیش از اجرا باید سرور روی
پورت ۳۰۰۰ در حال اجرا باشد (`npm start` در ریشهٔ پروژه) و باندلِ تست ساخته شود:

```bash
npx esbuild public/js/main.js --bundle --format=iife --outfile=/tmp/bundle.js --global-name=__core
npx esbuild tools/qc-test/testentry.js --bundle --format=iife --outfile=tools/qc-test/testbundle.js
```

| فایل | کاری که می‌کند |
| --- | --- |
| `apitest.sh` | تست همهٔ endpointهای API با سه نقش (شامل بررسی دسترسی ۴۰۳/۴۰۱، ساختار `/api/insights` و نبودِ ستون «شماره سفارش» در رکوردها) |
| `render.mjs` | رندر همهٔ صفحه‌ها در jsdom برای دو منبع و گزارش خطاهای زمان اجرا |
| `analysttest.mjs` | تست کامل موتور تحلیل: ساختار خروجی `/api/insights` برای هر سه منبع + صفحهٔ «تحلیلگر خودکار» در رابط (کلیات، آلارم‌ها، TOP 10، فیلتر شدت، و دریلِ واقعی به رکوردها با فیلترِ درست) |
| `analyststatic.mjs` | همان بررسی‌ها روی نسخهٔ تک‌فایل آفلاین (`QC-Dashboard.html`) برای هر سه منبع |
| `paretotest.mjs` | بررسی پارتو: پیش‌فرض «توضیحات تعمیرات» و تغییر به «کد عیب» در سه صفحه |
| `drillstatic.mjs` | بررسی نسخهٔ آفلاین: روند روزانه، تغییر منبع، چهار سطح تحلیل گام‌به‌گام و ستون‌های رکوردها |

اجرای سریع همه:

```bash
cd tools/qc-test
bash apitest.sh && node analysttest.mjs && node paretotest.mjs && node render.mjs
node analyststatic.mjs && node drillstatic.mjs      # نسخهٔ آفلاین (بدون نیاز به سرور)
```

> نکتهٔ تست‌نویسی: بستهٔ اصلی برنامه و `testbundle.js` دو نمونهٔ جدا از ماژول‌ها می‌سازند.
> برای آزمودنِ ناوبریِ واقعی (تغییر هش و فیلترها) باید صفحه را با `location.hash` باز کرد تا
> نمونهٔ اصلیِ برنامه رندر شود؛ فراخوانیِ مستقیمِ `window.__PAGES.…render()` فقط DOM را
> با نمونهٔ تست می‌سازد. به همین دلیل `analysttest.mjs` نشانی‌های درخواست را هم ضبط می‌کند
> و اعمالِ فیلتر را از روی خودِ درخواستِ `/api/records` می‌سنجد.
