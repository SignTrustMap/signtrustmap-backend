import json, urllib.request, random
BASE = "http://localhost:3000/api/v1"
def req(method, url, token=None, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method); r.add_header("Content-Type","application/json")
    if token: r.add_header("Authorization","Bearer "+token)
    for k,v in (headers or {}).items(): r.add_header(k,v)
    try:
        resp=urllib.request.urlopen(r,timeout=10); code=resp.status; txt=resp.read().decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        code=e.code; txt=e.read().decode("utf-8","replace")
    except Exception as e: return {"code":f"ERR {e}","body":None}
    try: return {"code":code,"body":json.loads(txt)}
    except Exception: return {"code":code,"body":txt[:140]}
def show(t,r):
    b=r['body']; print(f"{t:48} -> {r['code']}  {(json.dumps(b,ensure_ascii=False)[:200] if b is not None else '')}")
tok=req("POST",f"{BASE}/auth/login",body={"email":"admin@stm.dev","password":"Admin@123"})["body"]["accessToken"]
uid=req("GET",f"{BASE}/auth/me",token=tok)["body"]["id"]
suf=random.randint(100000,999999)
# places saved happy
ps=req("POST",f"{BASE}/places/saved",token=tok,body={"label":"Home","address":"1 Le Loi","latitude":10.77,"longitude":106.7})
show("POST places/saved (correct)",ps); pid=(ps["body"] or {}).get("id")
if pid: show("DELETE places/saved/:id",req("DELETE",f"{BASE}/places/saved/{pid}",token=tok))
# catalog categories lifecycle
cat=req("POST",f"{BASE}/catalog/categories",token=tok,body={"code":"Z"+str(suf),"nameVi":"Dang x","nameEn":"Cross"})
show("POST catalog/categories (correct)",cat); cid=(cat["body"] or {}).get("id")
if cid:
    show("GET catalog/categories/:id",req("GET",f"{BASE}/catalog/categories/{cid}",token=tok))
    show("PATCH catalog/categories/:id",req("PATCH",f"{BASE}/catalog/categories/{cid}",token=tok,body={"nameVi":"Doi x"}))
    show("DELETE catalog/categories/:id",req("DELETE",f"{BASE}/catalog/categories/{cid}",token=tok))
# sign-types lifecycle (recreate category to keep FK)
cat2=req("POST",f"{BASE}/catalog/categories",token=tok,body={"code":"Y"+str(suf),"nameVi":"Loai y","nameEn":"TypeY"})
show("POST catalog/categories (for FK)",cat2); cid2=(cat2["body"] or {}).get("id")
st=req("POST",f"{BASE}/catalog/sign-types",token=tok,body={"categoryId":cid2,"signCode":"ST"+str(suf),"nameVi":"Bien y","nameEn":"SignY"})
show("POST catalog/sign-types (correct)",st); sid=(st["body"] or {}).get("id")
if sid:
    show("GET catalog/sign-types/:id",req("GET",f"{BASE}/catalog/sign-types/{sid}",token=tok))
    show("PATCH catalog/sign-types/:id",req("PATCH",f"{BASE}/catalog/sign-types/{sid}",token=tok,body={"nameVi":"Doi y"}))
    show("DELETE catalog/sign-types/:id",req("DELETE",f"{BASE}/catalog/sign-types/{sid}",token=tok))
if cid2: show("DELETE catalog/categories/:id (FK parent)",req("DELETE",f"{BASE}/catalog/categories/{cid2}",token=tok))
# system parameters upsert + read
show("PUT admin/system-parameters/:key",req("PUT",f"{BASE}/admin/system-parameters/regression_key",token=tok,body={"value":"42","description":"reg"}))
show("GET admin/system-parameters/:key",req("GET",f"{BASE}/admin/system-parameters/regression_key",token=tok))
# submissions initialize happy
init=req("POST",f"{BASE}/submissions/initialize",token=tok,body={"originalFilename":"clip.mp4","mediaType":"VIDEO","totalSizeBytes":1048576,"totalChunks":2})
show("POST submissions/initialize (correct)",init); sid3=(init["body"] or {}).get("sessionId") or (init["body"] or {}).get("submissionId") or (init["body"] or {}).get("id")
if sid3:
    show("GET submissions/:sessionId",req("GET",f"{BASE}/submissions/{sid3}",token=tok))
    show("GET submissions/status/:submissionId",req("GET",f"{BASE}/submissions/status/{sid3}",token=tok))
# revalidation map snake_case
show("GET revalidation/tasks/map (snake)",req("GET",f"{BASE}/revalidation/tasks/map?min_lat=10&min_lon=105&max_lat=11&max_lon=107",token=tok))
# reviews/missing-type happy
mt=req("POST",f"{BASE}/reviews/missing-type",token=tok,body={"proposedName":"Bien loai moi","description":"reg"})
show("POST reviews/missing-type (correct)",mt); mr=(mt["body"] or {}).get("id")
if mr: show("GET moderation/missing-type-reports/:id",req("GET",f"{BASE}/moderation/missing-type-reports/{mr}",token=tok))
# daily-tasks claim numeric not-found
show("POST daily-tasks/999999/claim",req("POST",f"{BASE}/daily-tasks/999999/claim",token=tok))
# admin users status/roles happy-ish (bad enum / not found)
show("PATCH admin/users/<bad-uuid>/status",req("PATCH",f"{BASE}/admin/users/00000000-0000-0000-0000-000000000000/status",token=tok,body={"status":"SUSPENDED"}))
show("POST admin/users/<bad-uuid>/roles",req("POST",f"{BASE}/admin/users/00000000-0000-0000-0000-000000000000/roles",token=tok,body={"roleCode":"REVIEWER"}))
# internal active-learning-priorities valid shape
show("PATCH reviews/internal/<uuid>/al-priority",req("PATCH",f"{BASE}/reviews/internal/00000000-0000-0000-0000-000000000000/active-learning-priority",headers={"x-internal-token":"stm_internal_secret_dev"},body={"priority":0.9}))
show("POST submissions/internal/<uuid>/complete",req("POST",f"{BASE}/submissions/internal/00000000-0000-0000-0000-000000000000/complete",headers={"x-internal-token":"stm_internal_secret_dev"},body={}))
show("PATCH submissions/internal/<uuid>/status",req("PATCH",f"{BASE}/submissions/internal/00000000-0000-0000-0000-000000000000/status",headers={"x-internal-token":"stm_internal_secret_dev"},body={"status":"QUEUED"}))
# wallet internal deduct happy path: top up first via custom (mock completes?), then deduct
req("POST",f"{BASE}/wallet/top-up/custom",token=tok,body={"amount":100})
show("POST wallet/internal/deduct after topup",req("POST",f"{BASE}/wallet/internal/deduct",body={"userId":uid,"amount":1,"referenceType":"regression","referenceId":"00000000-0000-0000-0000-000000000000","description":"reg"},headers={"x-internal-token":"stm_internal_secret_dev"}))
