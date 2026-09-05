import json, urllib.request, random

BASE = "http://localhost:3000/api/v1"

def req(method, url, token=None, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items(): r.add_header(k, v)
    try:
        resp = urllib.request.urlopen(r, timeout=10); code = resp.status; txt = resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        code = e.code; txt = e.read().decode("utf-8","replace")
    except Exception as e:
        return {"code": f"ERR {e}", "body": None}
    try: return {"code": code, "body": json.loads(txt)}
    except Exception: return {"code": code, "body": txt[:140]}

def show(tag, r):
    b = r['body']
    print(f"{tag:50} -> {r['code']}  {(json.dumps(b, ensure_ascii=False)[:240] if b is not None else '')}")

lr = req("POST", f"{BASE}/auth/login", body={"email":"admin@stm.dev","password":"Admin@123"})
tok = lr["body"]["accessToken"]
uid = lr["body"]["user"]["id"]
suf = random.randint(1000,9999)
reg = req("POST", f"{BASE}/auth/register", body={"email":f"reg_{suf}@stm.dev","password":"Reg@1234","fullName":"Reg User"})
show("POST auth/register (new)", reg)
surv = (reg["body"] or {}).get("accessToken") or req("POST", f"{BASE}/auth/login", body={"email":f"reg_{suf}@stm.dev","password":"Reg@1234"})["body"].get("accessToken")
show("GET admin/users (surveyor)", req("GET", f"{BASE}/admin/users", token=surv))
show("GET auth/me (NO token)", req("GET", f"{BASE}/auth/me"))
show("GET wallet (NO token)", req("GET", f"{BASE}/wallet"))
show("PATCH auth/me", req("PATCH", f"{BASE}/auth/me", token=tok, body={"fullName":"Admin STM"}))
show("POST auth/forgot-password", req("POST", f"{BASE}/auth/forgot-password", body={"email":"admin@stm.dev"}))
show("POST auth/verify-otp (bad)", req("POST", f"{BASE}/auth/verify-otp", body={"email":"admin@stm.dev","otp":"000000"}))
show("POST auth/resend-otp", req("POST", f"{BASE}/auth/resend-otp", body={"email":"admin@stm.dev"}))
show("POST auth/reset-password (bad)", req("POST", f"{BASE}/auth/reset-password", body={"email":"admin@stm.dev","otp":"000000","newPassword":"Xyz@12345"}))
show("GET auth/google (NO token)", req("GET", f"{BASE}/auth/google"))
show("POST payments/webhook (junk)", req("POST", f"{BASE}/payments/webhook", body={"orderCode":"X","status":"success"}))
show("POST wallet/top-up/custom {50}", req("POST", f"{BASE}/wallet/top-up/custom", token=tok, body={"amount":50}))
show("POST wallet/top-up {pkg1}", req("POST", f"{BASE}/wallet/top-up", token=tok, body={"packageId":1}))
pm = req("POST", f"{BASE}/wallet/payment-methods", token=tok, body={"type":"CARD","provider":"VNPAY","tokenInfo":"test-123","isDefault":True})
show("POST wallet/payment-methods", pm); pmid=(pm["body"] or {}).get("id")
if pmid: show("DELETE wallet/payment-methods/:id", req("DELETE", f"{BASE}/wallet/payment-methods/{pmid}", token=tok))
ps = req("POST", f"{BASE}/places/saved", token=tok, body={"name":"Reg Place","address":"1 Le Loi","lat":10.77,"lon":106.7})
show("POST places/saved", ps); pid=(ps["body"] or {}).get("id")
if pid: show("DELETE places/saved/:id", req("DELETE", f"{BASE}/places/saved/{pid}", token=tok))
rs = req("POST", f"{BASE}/places/recent-searches", token=tok, body={"query":"reg search","lat":10.7,"lon":106.7})
show("POST places/recent-searches", rs); rid=(rs["body"] or {}).get("id")
if rid: show("DELETE places/recent-searches/:id", req("DELETE", f"{BASE}/places/recent-searches/{rid}", token=tok))
show("DELETE places/recent-searches (all)", req("DELETE", f"{BASE}/places/recent-searches", token=tok))
show("PATCH notifications/read-all", req("PATCH", f"{BASE}/notifications/read-all", token=tok))
show("POST daily-tasks/<bad-uuid>/claim", req("POST", f"{BASE}/daily-tasks/00000000-0000-0000-0000-000000000000/claim", token=tok))
show("POST leaderboard/refresh", req("POST", f"{BASE}/leaderboard/refresh", token=tok))
cat = req("POST", f"{BASE}/catalog/categories", token=tok, body={"name":"RegCat"+str(suf),"code":"REG"+str(suf),"icon":"star"})
show("POST catalog/categories", cat); cid=(cat["body"] or {}).get("id")
if cid:
    show("GET catalog/categories/:id", req("GET", f"{BASE}/catalog/categories/{cid}", token=tok))
    show("PATCH catalog/categories/:id", req("PATCH", f"{BASE}/catalog/categories/{cid}", token=tok, body={"name":"Renamed"+str(suf)}))
    show("DELETE catalog/categories/:id", req("DELETE", f"{BASE}/catalog/categories/{cid}", token=tok))
show("GET catalog/categories/:id (bad)", req("GET", f"{BASE}/catalog/categories/999999999", token=tok))
st = req("POST", f"{BASE}/catalog/sign-types", token=tok, body={"categoryId": cid or 1, "name":"RegType"+str(suf), "code":"RT"+str(suf)})
show("POST catalog/sign-types", st); sid=(st["body"] or {}).get("id")
if sid:
    show("GET catalog/sign-types/:id", req("GET", f"{BASE}/catalog/sign-types/{sid}", token=tok))
    show("DELETE catalog/sign-types/:id", req("DELETE", f"{BASE}/catalog/sign-types/{sid}", token=tok))
show("GET admin/system-parameters/:key", req("GET", f"{BASE}/admin/system-parameters/navigation_credit_fee", token=tok))
show("GET admin/signs/export", req("GET", f"{BASE}/admin/signs/export", token=tok))
init = req("POST", f"{BASE}/submissions/initialize", token=tok, body={"totalChunks":1,"deviceInfo":"reg","imageMeta":{"width":100,"height":100}})
show("POST submissions/initialize", init); sub=(init["body"] or {}).get("sessionId") or (init["body"] or {}).get("id")
if sub:
    show("GET submissions/:sessionId", req("GET", f"{BASE}/submissions/{sub}", token=tok))
    show("GET submissions/status/:submissionId", req("GET", f"{BASE}/submissions/status/{sub}", token=tok))
show("GET revalidation/tasks/map (bbox)", req("GET", f"{BASE}/revalidation/tasks/map?minLat=10&maxLat=11&minLon=105&maxLon=107", token=tok))
mt = req("POST", f"{BASE}/reviews/missing-type", token=tok, body={"signId":"00000000-0000-0000-0000-000000000000","suggestedTypeCode":"STOP","description":"reg report"})
show("POST reviews/missing-type", mt); mr=(mt["body"] or {}).get("id")
if mr:
    show("GET moderation/missing-type-reports/:id", req("GET", f"{BASE}/moderation/missing-type-reports/{mr}", token=tok))
show("POST wallet/internal/deduct (internal)", req("POST", f"{BASE}/wallet/internal/deduct", body={"userId":uid,"amount":1,"referenceType":"regression"}, headers={"x-internal-token":"stm_internal_secret_dev"}))
show("POST wallet/internal/deduct (NO token)", req("POST", f"{BASE}/wallet/internal/deduct", body={"userId":uid,"amount":1}))
show("GET reviews/internal/unscored (internal)", req("GET", f"{BASE}/reviews/internal/unscored-candidates", headers={"x-internal-token":"stm_internal_secret_dev"}))
show("GET reviews/internal/unscored (NO token)", req("GET", f"{BASE}/reviews/internal/unscored-candidates"))
show("POST reviews/internal/al-priorities", req("POST", f"{BASE}/reviews/internal/active-learning-priorities", body={"items":[]}, headers={"x-internal-token":"stm_internal_secret_dev"}))
