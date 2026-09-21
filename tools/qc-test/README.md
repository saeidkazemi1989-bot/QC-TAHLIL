# ابزارهای تست رابط کاربری

نیاز: `npm install` در این پوشه (فقط jsdom). پیش از اجرا باید سرور روی
پورت ۳۰۰۰ در حال اجرا باشد (`npm start` در ریشهٔ پروژه) و باندلِ تست ساخته شود:

```bash
npx esbuild public/js/main.js --bundle --format=iife --outfile=/tmp/bundle.js --global-name=__core
npx esbuild tools/qc-test/testentry.js --bundle --format=iife --outfile=tools/qc-test/testbundle.js
```

| فایل | کاری که می‌کند |
| --- | --- |
| `apitest.sh` | تست همهٔ endpointهای API با سه نقش (شامل بررسی دسترسی ۴۰۳/۴۰۱) |
| `render.mjs` | رندر همهٔ صفحه‌ها در jsdom برای دو منبع و گزارش خطاهای زمان اجرا |
| `drillstatic.mjs` | بررسی نسخهٔ آفلاین (`QC-Dashboard.html`): روند روزانه، تغییر منبع، چهار سطح تحلیل گام‌به‌گام |
| `productstatic.mjs` | بررسی نسخهٔ آفلاین: انتخاب‌گر محصول (کد عیب × مرحله) و کارتِ بررسی شمارش |
