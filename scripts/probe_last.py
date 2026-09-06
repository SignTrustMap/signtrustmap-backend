import json, urllib.request, urllib.error
BASE = "http://localhost:3000/api/v1"; F = "http://localhost:8000/api/v1"
def r(m, u, t=None, b=None, h=None):
    d = json.dumps(b).encode() if b is not None else None
    x = urllib.request.Request(u, data=d, method=m)
    x.add_header("Content-Type", "application/json")
    if t: x.add_header("Authorization", "Bearer " + t)
    for k, v in (h or {}).items(): x.add_header(k, v)
    try:
        rp = urllib.request.urlopen(x, timeout=10); return rp.status, rp.read().decode("utf-8", "replace")[:4000]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:4000]
    except Exception as e:
        return "ERR", str(e)[:120]
tok = json.loads(r("POST", BASE + "/auth/login", b={"email": "admin@stm.dev", "password": "Admin@123"})[1])["accessToken"]
print("pay create", r("POST", BASE + "/wallet/payment-methods", tok, {"cardHolderName": "Admin STM", "cardLast4": "4242", "cardBrand": "VISA", "expiryMonth": "12", "expiryYear": "2030"}))
print("pay create bad", r("POST", BASE + "/wallet/payment-methods", tok, {"foo": 1}))
print("google", r("GET", BASE + "/auth/google"))
print("googlecb", r("GET", BASE + "/auth/google/callback"))
print("fapi bad param", r("GET", F + "/spatial/signs?min_lat=abc&max_lat=11&min_lon=105&max_lon=107"))
print("fapi missing param", r("GET", F + "/spatial/signs"))
print("topup bad pkg", r("POST", BASE + "/wallet/top-up", tok, {"packageId": 999999}))
print("patch notif read (bad)", r("PATCH", BASE + "/notifications/00000000-0000-0000-0000-000000000000/read", tok))
print("vote bad candidate", r("POST", BASE + "/reviews/00000000-0000-0000-0000-000000000000/vote", tok, {"decision": "APPROVE"}))
print("candidate report", r("POST", BASE + "/reviews/candidates/00000000-0000-0000-0000-000000000000/report", tok, {"reason": "spam"}))
print("cni", r("POST", BASE + "/reviews/candidates/00000000-0000-0000-0000-000000000000/can-not-identify", tok))
print("get candidate", r("GET", BASE + "/reviews/candidates/00000000-0000-0000-0000-000000000000", tok))
print("history", r("GET", BASE + "/reviews/me/history", tok))
print("chunks bad", r("POST", BASE + "/submissions/00000000-0000-0000-0000-000000000000/chunks?chunkIndex=0", tok))
print("reval task", r("GET", BASE + "/revalidation/tasks/00000000-0000-0000-0000-000000000000", tok))
print("reval bad id", r("GET", BASE + "/revalidation/tasks/1", tok))
print("evidences", r("GET", BASE + "/revalidation/tasks/00000000-0000-0000-0000-000000000000/evidences", tok))
print("finalize", r("POST", BASE + "/revalidation/tasks/00000000-0000-0000-0000-000000000000/finalize", tok, {}))
print("evote", r("POST", BASE + "/revalidation/evidence/00000000-0000-0000-0000-000000000000/vote", tok, {"decision": "CONFIRM"}))
print("edecisions", r("GET", BASE + "/revalidation/evidence/00000000-0000-0000-0000-000000000000/decisions", tok))
print("case detail", r("GET", BASE + "/moderation/cases/00000000-0000-0000-0000-000000000000", tok))
print("case resolve", r("PUT", BASE + "/moderation/cases/00000000-0000-0000-0000-000000000000/resolve", tok, {"resolutionNote": "done"}))
print("missing report patch", r("PATCH", BASE + "/moderation/missing-type-reports/00000000-0000-0000-0000-000000000000", tok, {"status": "REVIEWED"}))
