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
t "admin-files" "$A" "$BASE/api/admin/files"
t "admin-users" "$A" "$BASE/api/admin/users"
echo "-----"; echo "موفق: $pass | ناموفق: $fail"
