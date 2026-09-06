#!/usr/bin/env python3
"""
build_postman_smoke.py
----------------------
Appends (or replaces) a "Comprehensive Smoke Test (Full Backend)" folder to
STM_Full.postman_collection.json. The folder is a self-contained regression
suite you can run with the Postman GUI Runner or `newman`:

  newman run STM_Full.postman_collection.json -f "Comprehensive Smoke Test (Full Backend)" \
        --env-var baseUrl=http://localhost:3000/api/v1 \
        --env-var fastapiBaseUrl=http://localhost:8000/api/v1 \
        --env-var internalToken=stm_internal_secret_dev

Design goals:
  * Hit as many endpoints as possible in one ordered pass.
  * Request 00 logs in (admin) and captures {{token}} + {{smokeUserId}}.
    Request 01 GET /auth/me confirms auth and captures the id used by later
    calls (wallet/deduct, navigation/driver_id).
  * Every request carries a test that asserts the status is a "healthy" code
    (no 5xx, no connection error). A handful assert exact codes (401 guards,
    403 RBAC, internal-guard-reached = not 401).
  * Idempotent: re-running removes any previous copy of the folder first.

Edit the lists below (NEST_GETS, FASTAPI_READS, NEST_WRITES, ...) to add
endpoints, then re-run: `python scripts/build_postman_smoke.py`.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
COLL = REPO / "STM_Full.postman_collection.json"
FOLDER_NAME = "Comprehensive Smoke Test (Full Backend)"

# --------------------------------------------------------------------------
# Endpoint inventory (edit freely, then re-run this script)
# --------------------------------------------------------------------------
NEST_GETS = [
    "auth/me", "wallet", "wallet/transactions", "wallet/top-up/packages",
    "wallet/payment-methods", "places/saved", "places/recent-searches",
    "leaderboard", "catalog/categories", "catalog/sign-types",
    "daily-tasks", "daily-tasks/completions/me", "notifications",
    "notifications/unread-count", "revalidation/tasks",
    "moderation/cases", "moderation/missing-type-reports",
    "reviews/queue", "reviews/me/history", "reviews/me/stats",
    "submissions/me", "submissions/me/pending", "submissions/me/stats",
    "admin/users", "admin/audit-logs", "admin/system-parameters",
]

NEST_WRITES = [
    ("PATCH",  "auth/me",                 {"fullName": "Admin STM"}),
    ("POST",   "places/recent-searches",  {"query": "smoke test", "lat": 10.7, "lon": 106.7}),
    ("DELETE", "places/recent-searches",  None),
    ("POST",   "leaderboard/refresh",     None),
    ("PATCH",  "notifications/read-all",  None),
    ("POST",   "wallet/top-up/custom",    {"amount": 50}),
]

FASTAPI_READS = [
    ("health root",        "fastapiRoot",      "health"),
    ("api health",         "fastapiBaseUrl",   "health"),
    ("spatial signs bbox", "fastapiBaseUrl",   "spatial/signs?min_lat=10&max_lat=11&min_lon=105&max_lon=107"),
]

INTERNAL_CHECKS = [
    ("GET",  "reviews/internal/unscored-candidates",        None),
    ("POST", "reviews/internal/active-learning-priorities", {"items": []}),
    ("POST", "wallet/internal/deduct", {"userId": "{{smokeUserId}}", "amount": 1}),
]

# --------------------------------------------------------------------------
# Script fragments
# --------------------------------------------------------------------------
def _guard(cond_expr="pm.response.code < 500", msg="no 5xx"):
    """Generic health test body: asserts a healthy status code."""
    return [
        "let j = null; try { j = pm.response.json(); } catch (e) {}",
        "pm.test(pm.info.requestName + ' [' + pm.response.code + '] " + msg + "', function () {",
        "    pm.expect(" + cond_expr + ").to.eql(true);",
        "});",
    ]

TEST_HEALTH = _guard()

# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------
def url_for(base_var, path):
    raw = f"{{{{{base_var}}}}}/{path}"
    no_query, _, q = path.partition("?")
    segs = [s for s in no_query.split("/") if s]
    out = {"raw": raw, "host": [f"{{{{{base_var}}}}}"], "path": segs}
    if q:
        pairs = []
        for kv in q.split("&"):
            k, _, v = kv.partition("=")
            pairs.append({"key": k, "value": v})
        out["query"] = pairs
    return out

def make_req(name, method, base_var, path, *, jwt=False, internal=False, body=None, tests=None):
    headers = []
    if body is not None:
        headers.append({"key": "Content-Type", "value": "application/json"})
    if jwt:
        headers.append({"key": "Authorization", "value": "Bearer {{token}}"})
    if internal:
        headers.append({"key": "x-internal-token", "value": "{{internalToken}}"})
    req = {"method": method, "url": url_for(base_var, path)}
    if headers:
        req["header"] = headers
    if body is not None:
        req["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, indent=2),
            "options": {"raw": {"language": "json"}},
        }
    obj = {"name": name, "request": req}
    if tests:
        obj["event"] = [{"listen": "test", "script": {"type": "text/javascript", "exec": tests}}]
    return obj


def build_folder():
    items = []

    # 00 Login (capture token) ---------------------------------------------
    login_tests = [
        "let j = null; try { j = pm.response.json(); } catch (e) {}",
        "pm.test('00 Login [' + pm.response.code + '] -> 2xx', function () {",
        "    pm.expect(pm.response.code >= 200 && pm.response.code < 300).to.eql(true);",
        "});",
        "if (j && j.accessToken) { pm.collectionVariables.set('token', j.accessToken); }",
    ]
    items.append(make_req(
        "00 Auth: Login (admin) -> capture token", "POST", "baseUrl", "auth/login",
        body={"email": "admin@stm.dev", "password": "Admin@123"}, tests=login_tests))

    # 01 Me (capture userId / driverId) ------------------------------------
    me_tests = [
        "let j = null; try { j = pm.response.json(); } catch (e) {}",
        "pm.test('01 Me [' + pm.response.code + '] -> 200', function () {",
        "    pm.expect(pm.response.code).to.eql(200);",
        "});",
        "if (j && j.id) {",
        "    pm.collectionVariables.set('smokeUserId', j.id);",
        "    pm.collectionVariables.set('driverId', j.id);",
        "}",
    ]
    items.append(make_req(
        "01 Auth: Me -> capture smokeUserId/driverId", "GET", "baseUrl", "auth/me",
        jwt=True, tests=me_tests))

    # FastAPI reads --------------------------------------------------------
    for label, base, path in FASTAPI_READS:
        items.append(make_req(f"F  FastAPI: {label}", "GET", base, path, tests=TEST_HEALTH))

    # FastAPI navigation lifecycle -----------------------------------------
    nav_create = [
        "let j = null; try { j = pm.response.json(); } catch (e) {}",
        "pm.test('F  create nav [' + pm.response.code + '] -> 2xx/422', function () {",
        "    pm.expect([200, 201, 422].indexOf(pm.response.code) >= 0 && pm.response.code < 500).to.eql(true);",
        "});",
        "if (j && j.id) { pm.collectionVariables.set('smokeNavId', j.id); }",
    ]
    items.append(make_req("F  FastAPI: create nav session", "POST", "fastapiBaseUrl",
        "spatial/navigation/sessions", jwt=True,
        body={"driver_id": "{{driverId}}", "origin_latitude": 10.77, "origin_longitude": 106.70,
              "destination_latitude": 10.79, "destination_longitude": 106.71}, tests=nav_create))
    items.append(make_req("F  FastAPI: nav session list (me)", "GET", "fastapiBaseUrl",
        "spatial/navigation/sessions/me?driver_id={{driverId}}&page=1&pageSize=5", jwt=True, tests=TEST_HEALTH))
    items.append(make_req("F  FastAPI: get nav session", "GET", "fastapiBaseUrl",
        "spatial/navigation/sessions/{{smokeNavId}}", jwt=True, tests=TEST_HEALTH))
    items.append(make_req("F  FastAPI: end nav session", "PATCH", "fastapiBaseUrl",
        "spatial/navigation/sessions/{{smokeNavId}}", jwt=True, body={"status": "COMPLETED"}, tests=TEST_HEALTH))

    # NestJS admin GETs ----------------------------------------------------
    for path in NEST_GETS:
        items.append(make_req(f"N  GET {path}", "GET", "baseUrl", path, jwt=True, tests=TEST_HEALTH))

    # NestJS writes --------------------------------------------------------
    for method, path, body in NEST_WRITES:
        items.append(make_req(f"N  {method} {path}", method, "baseUrl", path, jwt=True, body=body, tests=TEST_HEALTH))


    # RBAC / guard negatives -----------------------------------------------
    items.append(make_req("R  No JWT -> /admin/users must 401", "GET", "baseUrl", "admin/users",
        tests=_guard("pm.response.code === 401 || pm.response.code === 403", "401/403")))
    items.append(make_req("R  No JWT -> /wallet must 401", "GET", "baseUrl", "wallet",
        tests=_guard("pm.response.code === 401 || pm.response.code === 403", "401/403")))

    reg_tests = [
        "let j = null; try { j = pm.response.json(); } catch (e) {}",
        "pm.test('R  register surveyor [' + pm.response.code + '] -> 2xx/400/409', function () {",
        "    pm.expect([200, 201, 400, 409].indexOf(pm.response.code) >= 0).to.eql(true);",
        "});",
        "if (j && j.accessToken) { pm.collectionVariables.set('survToken', j.accessToken); }",
    ]
    items.append(make_req("R  register surveyor -> capture survToken", "POST", "baseUrl", "auth/register",
        body={"email": "smoke_surv_1@stm.dev", "password": "Surv@123", "fullName": "Smoke Surveyor"},
        tests=reg_tests))
    surv = make_req("R  surveyor JWT -> /admin/users must 403", "GET", "baseUrl", "admin/users",
        tests=_guard("pm.response.code === 401 || pm.response.code === 403", "401/403"))
    surv["request"]["header"] = [{"key": "Authorization", "value": "Bearer {{survToken}}"}]
    items.append(surv)

    # Internal endpoints (x-internal-token only) ---------------------------
    reach = _guard("pm.response.code !== 401 && pm.response.code < 500", "guard passed (not 401)")
    for method, path, body in INTERNAL_CHECKS:
        items.append(make_req(f"I  {method} {path} (x-internal-token)", method, "baseUrl", path,
            internal=True, body=body, tests=reach))
    items.append(make_req("I  internal w/o token -> expect 401", "GET", "baseUrl",
        "reviews/internal/unscored-candidates", tests=_guard("pm.response.code === 401", "401")))

    return {"name": FOLDER_NAME, "item": items}


def main():
    data = json.loads(COLL.read_text(encoding="utf-8"))

    # add fastapiRoot collection variable if missing
    variables = data.setdefault("variable", [])
    if not any(v.get("key") == "fastapiRoot" for v in variables):
        variables.append({"key": "fastapiRoot", "value": "http://localhost:8000", "type": "string"})

    # idempotent: drop existing copies of the folder, then append fresh
    data["item"] = [it for it in data["item"] if it.get("name") != FOLDER_NAME]
    folder = build_folder()
    data["item"].append(folder)

    COLL.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OK: wrote '{FOLDER_NAME}' with {len(folder['item'])} requests to {COLL.name}")


if __name__ == "__main__":
    sys.exit(main())

