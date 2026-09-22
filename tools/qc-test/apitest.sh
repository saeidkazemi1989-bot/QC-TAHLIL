set -u
BASE=http://localhost:3000
tok(){ curl -s -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$1\"}" $BASE/api/auth/login | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }
A=$(tok admin); M=$(tok manager); E=$(tok expert)
pass=0; fail=0
t(){
  out=$(curl -s -H "Authorization: Bearer $2" "$3")
  if [ -z "$out" ] || [ "$out" = "null" ]; then echo "❌ $1 -> خالی"; fail=$((fail+1));
  else case "$out" in *'"error"'*) echo "❌ $1 -> $out"; fail=$((fail+1));; *) pass=$((pass+1));; esac; fi
}
Q=$(python3 -c "import urllib.parse;print(urllib.parse.quote('قلع'))")
for src in inprocess inspection polymer; do
  t "summary-$src" "$M" "$BASE/api/summary?source=$src"
  for g in day week month quarter; do t "trend-$src-$g" "$M" "$BASE/api/trend?source=$src&group=$g"; done
  for d in product_unified product station defect report repair_desc category stage; do t "bd-$d-$src" "$M" "$BASE/api/breakdown?source=$src&dim=$d&limit=12"; done
  t "matrix-$src" "$M" "$BASE/api/matrix?source=$src&row=final_group&col=defect_group&rows=8&cols=5"
  t "matrix-ps-$src" "$M" "$BASE/api/matrix?source=$src&row=product_unified&col=stage&rows=15&cols=8"
  t "drill-$src" "$E" "$BASE/api/drill?source=$src"
  t "records-$src" "$E" "$BASE/api/records?source=$src&page=1&size=10&sort=defect_qty&dir=DESC"
  t "records-q-$src" "$E" "$BASE/api/records?source=$src&page=1&size=5&q=$Q"
done
PROD=$(curl -s -H "Authorization: Bearer $M" "$BASE/api/breakdown?source=inprocess&dim=product_unified&limit=12" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['key'])")
t "matrix-ds" "$M" "$BASE/api/matrix?source=inprocess&row=defect&col=stage&rows=12&cols=8&product_unified=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$PROD'))")"
t "check-counts" "$A" "$BASE/api/admin/check-counts"
# ---- تحلیلگر خودکار (موتور تحلیل + آلارم‌ها) ----
for src in inprocess inspection polymer; do
  t "insights-$src" "$M" "$BASE/api/insights?source=$src"
  ins=$(curl -s -H "Authorization: Bearer $M" "$BASE/api/insights?source=$src")
  chk(){ if [ "$(python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(eval(sys.argv[1]))" "$1" <<<"$ins")" = "True" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "❌ insights-$src: $1"; fi; }
  chk "len(d['headline']['narrative'])>80"
  chk "len(d['alarms'])>=3"
  chk "len(d['top_repair'])>=1 and len(d['top_repair'])<=10"
  chk "len(d['focus'])>=5"
  chk "len(d['sources_overview'])==3"
  chk "d['basis']['label'] in ('توضیحات تعمیرات','کد عیب')"
  chk "all(a.get('title') and a.get('body') and a.get('action') and a.get('drill') for a in d['alarms'])"
  chk "all(x.get('story') and x.get('action') and x.get('products') is not None and x.get('stages') is not None for x in d['top_repair'])"
done
ins_a=$(curl -s -H "Authorization: Bearer $A" "$BASE/api/insights?source=inprocess")
if python3 -c "import sys,json;d=json.loads(sys.stdin.read());sys.exit(0 if d['basis']['label']=='توضیحات تعمیرات' else 1)" <<<"$ins_a"; then pass=$((pass+1)); else fail=$((fail+1)); echo "❌ insights: پایهٔ حین تولید باید توضیحات تعمیرات باشد"; fi
if python3 -c "import sys,json;d=json.loads(sys.stdin.read());sys.exit(0 if d['basis']['label']=='کد عیب' else 1)" <<<"$(curl -s -H "Authorization: Bearer $A" "$BASE/api/insights?source=inspection")"; then pass=$((pass+1)); else fail=$((fail+1)); echo "❌ insights: پایهٔ اسناد بازرسی باید کد عیب باشد"; fi
# با فیلتر تاریخ باید بازه رعایت شود
t "insights-dated" "$M" "$BASE/api/insights?source=inprocess&from=1405/06/01&to=1405/06/22"
t "times" "$E" "$BASE/api/times?dim=station&limit=8"
t "pfmea" "$E" "$BASE/api/pfmea?limit=60"
t "meta" "$M" "$BASE/api/meta"
for g in day week month; do t "prod-trend-$g" "$M" "$BASE/api/production/trend?group=$g"; done
t "prod-summary" "$M" "$BASE/api/production/summary"
for d in work_center process_domain category product final_group; do t "prod-bd-$d" "$M" "$BASE/api/production/breakdown?dim=$d&limit=20"; done
# شماره سفارش نباید در ستون‌های رکوردها نمایش داده شود
for src in inprocess inspection polymer; do
  out=$(curl -s -H "Authorization: Bearer $E" "$BASE/api/records?source=$src&page=1&size=3")
  if echo "$out" | grep -q '"order_no"'; then echo "❌ no-order-no-$src"; fail=$((fail+1)); else pass=$((pass+1)); fi
done
echo -n "مدیر ارشد → رکوردها (باید ۴۰۳): "; c=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $M" "$BASE/api/records?source=inprocess"); echo "$c"; [ "$c" = "403" ] && pass=$((pass+1)) || fail=$((fail+1))
echo -n "مدیر ارشد → مدیریت (باید ۴۰۳): "; c=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $M" "$BASE/api/admin/files"); echo "$c"; [ "$c" = "403" ] && pass=$((pass+1)) || fail=$((fail+1))
echo -n "بدون توکن (باید ۴۰۱): "; c=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/summary"); echo "$c"; [ "$c" = "401" ] && pass=$((pass+1)) || fail=$((fail+1))
# پاسخِ admin-files کلید «error» (برای نقشِ فایل‌ها) دارد؛ پس با python بررسی می‌شود نه grep
chkjson(){ # chkjson <نام> <توکن> <url> <عبارتِ پایتون>
  out=$(curl -s -H "Authorization: Bearer $2" "$3")
  if echo "$out" | python3 -c "import sys,json;d=json.load(sys.stdin);print(bool($4))" | grep -q True; then pass=$((pass+1));
  else echo "❌ $1 -> $4"; fail=$((fail+1)); fi
}
# یافته‌های تفکیک‌شدهٔ تحلیلگر: هر عدد در کارتِ خودش با برچسب و جملهٔ جدا
for src in inprocess inspection polymer; do
  chkjson "findings-$src" "$M" "$BASE/api/insights?source=$src" "len(d['headline']['findings'])>=6"
  chkjson "findings-shape-$src" "$M" "$BASE/api/insights?source=$src" "all(f.get('label') and f.get('value') is not None and f.get('text') for f in d['headline']['findings'])"
  chkjson "findings-icon-$src" "$M" "$BASE/api/insights?source=$src" "all(f.get('icon') and f.get('tone') for f in d['headline']['findings'])"
done
chkjson "admin-files" "$A" "$BASE/api/admin/files" "len(d['files'])>0 and any(f['folder']=='raw' for f in d['files']) and any(f['folder']=='clean' for f in d['files'])"
chkjson "admin-files-pipeline" "$A" "$BASE/api/admin/files" "d['pipeline']['enabled'] is True and 'state' in d['pipeline']"
chkjson "admin-pipeline-roles" "$A" "$BASE/api/admin/pipeline" "len(d['raw_roles']['files'])==4 and d['python_ready'] is True"
chkjson "admin-pipeline-clean" "$A" "$BASE/api/admin/pipeline" "d['clean_up_to_date'] is True and len(d['clean_files'])>=1"
chkjson "health-version" "" "$BASE/api/health" "len(d['data_version'])>5 and d['counts']['inprocess']>0"
chkjson "health-watcher" "" "$BASE/api/health" "d['watcher']['enabled'] is True and d['watcher']['state'] in ('idle','running')"
chkjson "health-uptodate" "" "$BASE/api/health" "d['watcher']['clean_up_to_date'] is True and d['watcher']['python_ready'] is True"
t "admin-users" "$A" "$BASE/api/admin/users"
echo -n "بازسازی بدون توکن (باید ۴۰۱): "; c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/admin/rebuild"); echo "$c"; [ "$c" = "401" ] && pass=$((pass+1)) || fail=$((fail+1))
echo -n "بازسازی با نقشِ کارشناس (باید ۴۰۳): "; c=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $E" "$BASE/api/admin/rebuild"); echo "$c"; [ "$c" = "403" ] && pass=$((pass+1)) || fail=$((fail+1))
echo "-----"; echo "موفق: $pass | ناموفق: $fail"
