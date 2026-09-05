import json, urllib.request

BASE = "http://localhost:3000/api/v1"
FAPI = "http://localhost:8000/api/v1"
ROOT = "http://localhost:8000"

def req(method, url, token=None, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if headers:
        for k, v in headers.items():
            r.add_header(k, v)
    try:
        resp = urllib.request.urlopen(r, timeout=8)
        code = resp.status
        txt = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code = e.code
        txt = e.read().decode("utf-8", "replace")
    except Exception as e:
        return {"code": f"ERR {e}", "shape": None}
    try:
        j = json.loads(txt)
    except Exception:
        return {"code": code, "shape": txt[:120]}
    return {"code": code, "shape": j}

def shape(j):
    if isinstance(j, dict):
        return {k: (type(v).__name__ if not isinstance(v, (dict, list)) else f"{type(v).__name__}[{len(v)}]") for k, v in j.items()}
    if isinstance(j, list):
        return ["LIST", shape(j[0]) if j and isinstance(j[0], dict) else (type(j[0]).__name__ if j else "empty"), f"len={len(j)}"]
    return type(j).__name__

# login
lr = req("POST", f"{BASE}/auth/login", body={"email": "admin@stm.dev", "password": "Admin@123"})
print("LOGIN code", lr["code"], "shape", shape(lr["shape"]))
tok = lr["shape"].get("accessToken") if isinstance(lr["shape"], dict) else None
if not tok:
    print("NO TOKEN - dumping full:", json.dumps(lr, ensure_ascii=False)[:500])

calls = [
    ("GET", f"{BASE}/auth/me"),
    ("GET", f"{BASE}/catalog/categories"),
    ("GET", f"{BASE}/catalog/sign-types"),
    ("GET", f"{BASE}/wallet"),
    ("GET", f"{BASE}/wallet/transactions"),
    ("GET", f"{BASE}/wallet/top-up/packages"),
    ("GET", f"{BASE}/wallet/payment-methods"),
    ("GET", f"{BASE}/leaderboard"),
    ("GET", f"{BASE}/daily-tasks"),
    ("GET", f"{BASE}/daily-tasks/completions/me"),
    ("GET", f"{BASE}/notifications"),
    ("GET", f"{BASE}/notifications/unread-count"),
    ("GET", f"{BASE}/admin/users?page=1&pageSize=2"),
    ("GET", f"{BASE}/admin/audit-logs?page=1&pageSize=2"),
    ("GET", f"{BASE}/admin/system-parameters"),
    ("GET", f"{BASE}/moderation/cases"),
    ("GET", f"{BASE}/moderation/missing-type-reports"),
    ("GET", f"{BASE}/reviews/queue"),
    ("GET", f"{BASE}/reviews/me/stats"),
    ("GET", f"{BASE}/submissions/me"),
    ("GET", f"{BASE}/submissions/me/stats"),
    ("GET", f"{BASE}/places/saved"),
    ("GET", f"{BASE}/places/recent-searches"),
    ("GET", f"{BASE}/revalidation/tasks?page=1&pageSize=2"),
    ("GET", f"{FAPI}/health"),
    ("GET", f"{ROOT}/health"),
    ("GET", f"{FAPI}/spatial/signs?min_lat=10&max_lat=11&min_lon=105&max_lon=107"),
]
for m, u in calls:
    t = None if "/health" in u or "/spatial/signs" in u else tok
    r = req(m, u, token=t)
    label = u.replace(BASE, "").replace(FAPI, "FAPI:").replace(ROOT, "ROOT:")
    print(f"\n{m} {label} -> {r['code']}")
    print("   shape:", json.dumps(shape(r["shape"]), ensure_ascii=False)[:400])
