import json, urllib.request, urllib.error
BASE = "http://localhost:3000/api/v1"
def r(m, u, t=None, b=None, h=None):
    d = json.dumps(b).encode() if b else None
    x = urllib.request.Request(u, data=d, method=m)
    x.add_header("Content-Type", "application/json")
    if t: x.add_header("Authorization", "Bearer " + t)
    for k, v in (h or {}).items(): x.add_header(k, v)
    try:
        rp = urllib.request.urlopen(x, timeout=10); return rp.status, json.loads(rp.read().decode())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode() or "{}")
    except Exception as e: return "ERR", str(e)
tok = r("POST", BASE + "/auth/login", b={"email": "admin@stm.dev", "password": "Admin@123"})[1]["accessToken"]
rpts = r("GET", BASE + "/moderation/missing-type-reports", tok)[1]
print("reports total:", rpts.get("total"), "first id:", (rpts.get("items") or [{}])[0].get("id","none"))
rid = ((rpts.get("items") or [{}])[0].get("id") or "00000000-0000-0000-0000-000000000000")
p = r("PATCH", BASE + "/moderation/missing-type-reports/" + rid, tok, {"status": "REVIEWED"})
print("PATCH ->", p[0], json.dumps(p[1], ensure_ascii=False)[:200])
# Check what catalog categories actually returns
c,cats = r("GET", BASE + "/catalog/categories", tok)
print("catalog/categories->", c, type(cats).__name__, list(cats.keys()) if isinstance(cats,dict) else "is array len=" + str(len(cats)))
c,sts = r("GET", BASE + "/catalog/sign-types", tok)
print("catalog/sign-types->", c, type(sts).__name__, list(sts.keys()) if isinstance(sts,dict) else "is array len=" + str(len(sts)))
c,pend = r("GET", BASE + "/submissions/me/pending", tok)
print("submissions/me/pending->", c, list(pend.keys()) if isinstance(pend,dict) else pend[:3])
