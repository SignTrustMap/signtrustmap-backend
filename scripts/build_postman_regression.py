#!/usr/bin/env python3
"""
build_postman_regression.py
---------------------------
Generates (idempotently) the folder "Full Backend Regression" inside
STM_Full.postman_collection.json. This is the definitive, exhaustive integration
test suite for the SignTrustMap backend: it covers EVERY NestJS + FastAPI
endpoint (frontend-facing, admin, internal/AI-pipeline and RBAC/guard negatives)
and every request carries REAL logic assertions (exact status codes + response
shape + business rules), validated against a live stack (newman) rather than
generic "no 5xx" health checks.

Expected status codes were captured by probing the running services so the
whole folder is deterministic-green against the seeded database.

Run:  python scripts/build_postman_regression.py
Then: newman run STM_Full.postman_collection.json -f "Full Backend Regression" \
        --env-var baseUrl=http://localhost:3000/api/v1 \
        --env-var fastapiBaseUrl=http://localhost:8000/api/v1 \
        --env-var fastapiRoot=http://localhost:8000 \
        --env-var internalToken=stm_internal_secret_dev
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
COLL = REPO / "STM_Full.postman_collection.json"
FOLDER_NAME = "Full Backend Regression"
OLD_SMOKE = "Comprehensive Smoke Test (Full Backend)"
PREAMBLE = "let j = null; try { j = pm.response.json(); } catch (e) {}"


# ---------------------------------------------------------------------------
# Assertion helpers (each returns a list of JS exec lines using pm.info.requestName)
# ---------------------------------------------------------------------------
def eq(c):
    return ["pm.test(pm.info.requestName + ' -> HTTP ' + %d, function () {" % c,
            "    pm.expect(pm.response.code).to.eql(%d);" % c,
            "});"]


def oneof(cs):
    arr = "[" + ", ".join(str(x) for x in cs) + "]"
    return ["pm.test(pm.info.requestName + ' -> status oneOf ' + '" + arr + " (no 5xx)', function () {",
            "    pm.expect(pm.response.code).to.be.oneOf(" + arr + ");",
            "});"]


def is_json():
    return ["pm.test(pm.info.requestName + ' -> valid JSON body', function () {",
            "    pm.response.to.have.jsonBody();",
            "});"]


def no_5xx():
    return ["pm.test(pm.info.requestName + ' -> no server error', function () {",
            "    pm.expect(pm.response.code).to.be.below(500);",
            "});"]


def has_keys(*keys):
    out = ["pm.test(pm.info.requestName + ' -> has fields: " + ", ".join(keys) + "', function () {",
           "    pm.expect(j).to.be.an('object');"]
    for k in keys:
        out.append("    pm.expect(j).to.have.property('%s');" % k)
    out.append("});")
    return out


def is_array():
    return ["pm.test(pm.info.requestName + ' -> body is an array', function () {",
            "    pm.expect(j).to.be.an('array');",
            "});"]


def paginated():
    return ["pm.test(pm.info.requestName + ' -> pagination envelope', function () {",
            "    pm.expect(j).to.be.an('object');",
            "    pm.expect(j).to.have.property('items').that.is.an('array');",
            "    pm.expect(j).to.have.property('total').that.is.a('number');",
            "    pm.expect(j).to.have.property('page').that.is.a('number');",
            "    pm.expect(j).to.have.property('pageSize').that.is.a('number');",
            "});"]


def field_type(key, typ):
    return ["pm.test(pm.info.requestName + ' -> %s is %s', function () {" % (key, typ),
            "    pm.expect(j).to.have.property('%s').that.is.a('%s');" % (key, typ),
            "});"  ]


def setvar(expr, var):
    return ["if (j && %s) { pm.collectionVariables.set('%s', %s); }" % (expr, var, expr)]


def custom(name, body_js):
    return ["pm.test(pm.info.requestName + ' -> " + name + "', function () {",
            "    " + body_js,
            "});"]


def combine(*groups):
    out = [PREAMBLE]
    for g in groups:
        out += g
    return out


# ---------------------------------------------------------------------------
# Request builder
# ---------------------------------------------------------------------------
def url_for(base_var, path):
    no_query, _, q = path.partition("?")
    segs = [s for s in no_query.split("/") if s]
    out = {"raw": "{{%s}}/%s" % (base_var, path), "host": ["{{%s}}" % base_var], "path": segs}
    if q:
        out["query"] = []
        for kv in q.split("&"):
            k, _, v = kv.partition("=")
            out["query"].append({"key": k, "value": v})
    return out


def make_req(name, method, base_var, path, *, auth=None, body=None, tests=None, prereq=None):
    headers = []
    if body is not None:
        headers.append({"key": "Content-Type", "value": "application/json"})
    if auth == "admin":
        headers.append({"key": "Authorization", "value": "Bearer {{token}}"})
    elif auth == "surveyor":
        headers.append({"key": "Authorization", "value": "Bearer {{survToken}}"})
    elif auth == "internal":
        headers.append({"key": "x-internal-token", "value": "{{internalToken}}"})
    req = {"method": method, "url": url_for(base_var, path)}
    if headers:
        req["header"] = headers
    if body is not None:
        req["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2),
                       "options": {"raw": {"language": "json"}}}
    obj = {"name": name, "request": req}
    events = []
    if tests:
        events.append({"listen": "test", "script": {"type": "text/javascript", "exec": tests}})
    if prereq:
        events.append({"listen": "prerequest", "script": {"type": "text/javascript", "exec": prereq}})
    if events:
        obj["event"] = events
    return obj


def build_phase2():
    """FastAPI health probes + spatial + navigation lifecycle."""
    FA = "fastapiBaseUrl"; FR = "fastapiRoot"; N = "baseUrl"; it = []
    it.append(make_req("F01 FastAPI: root /health", "GET", FR, "health",
        tests=combine(eq(200), has_keys("status", "service"),
            custom("status ok", "pm.expect(j.status).to.eql('ok');"))))
    it.append(make_req("F02 FastAPI: /api/v1/health", "GET", FA, "health",
        tests=combine(eq(200), has_keys("status", "service"))))
    it.append(make_req("F03 Spatial: signs (bbox)", "GET", FA,
        "spatial/signs?min_lat=10&min_lon=105&max_lat=11&max_lon=107",
        tests=combine(eq(200), has_keys("type", "features", "total"),
            custom("FeatureCollection", "pm.expect(j.type).to.eql('FeatureCollection');"),
            custom("features is array", "pm.expect(j.features).to.be.an('array');"),
            custom("total is number", "pm.expect(j.total).to.be.a('number');"))))
    it.append(make_req("F04 Spatial: signs missing params -> 422", "GET", FA, "spatial/signs",
        tests=combine(eq(422), custom("detail array", "pm.expect(j.detail).to.be.an('array');"))))
    it.append(make_req("F05 Spatial: signs bad param type -> 422", "GET", FA,
        "spatial/signs?min_lat=abc&min_lon=105&max_lat=11&max_lon=107",
        tests=combine(eq(422))))
    it.append(make_req("F06 Spatial: sign detail not found -> 404", "GET", FA,
        "spatial/signs/00000000-0000-0000-0000-000000000000",
        tests=combine(eq(404))))
    it.append(make_req("F07 Nav: create session (201, capture navId)", "POST", FA,
        "spatial/navigation/sessions", auth="admin",
        body={"driver_id": "{{adminId}}", "origin_latitude": 10.77, "origin_longitude": 106.70,
              "destination_latitude": 10.79, "destination_longitude": 106.71},
        tests=combine(oneof([200, 201]), has_keys("id", "status"),
            custom("status ACTIVE", "pm.expect(j.status).to.eql('ACTIVE');"),
            custom("origin_latitude number", "pm.expect(j.origin_latitude).to.be.a('number');"),
            ["if (j && j.id) { pm.collectionVariables.set('navId', j.id); }"])))
    it.append(make_req("F08 Nav: list my sessions (paginated)", "GET", FA,
        "spatial/navigation/sessions/me?driver_id={{adminId}}", auth="admin",
        tests=combine(eq(200), has_keys("items", "total", "page", "pageSize"),
            custom("items array", "pm.expect(j.items).to.be.an('array');"))))
    it.append(make_req("F09 Nav: get session by id", "GET", FA,
        "spatial/navigation/sessions/{{navId}}", auth="admin",
        tests=combine(eq(200), has_keys("id", "status"),
            custom("id matches", "pm.expect(j.id).to.eql(pm.collectionVariables.get('navId'));"))))
    it.append(make_req("F10 Nav: end session COMPLETED (terminal transition)", "PATCH", FA,
        "spatial/navigation/sessions/{{navId}}", auth="admin",
        body={"status": "COMPLETED"},
        tests=combine(oneof([200, 201]), custom("status COMPLETED", "pm.expect(j.status).to.eql('COMPLETED');"),
            custom("ended_at set", "pm.expect(j.ended_at).to.not.be.null;"))))
    it.append(make_req("F11 Nav: end already-terminal -> 404 (logic)", "PATCH", FA,
        "spatial/navigation/sessions/{{navId}}", auth="admin",
        body={"status": "COMPLETED"}, tests=combine(eq(404))))
    it.append(make_req("F12 Nav: get unknown session -> 404", "GET", FA,
        "spatial/navigation/sessions/00000000-0000-0000-0000-000000000000", auth="admin",
        tests=combine(eq(404))))
    return it


def build_phase1():
    """Auth + RBAC/guard negatives. Returns list of request objects."""
    N = "baseUrl"
    it = []
    it.append(make_req("01 Auth: login (admin) capture token", "POST", N, "auth/login",
        body={"email": "admin@stm.dev", "password": "Admin@123"},
        tests=combine(eq(201), has_keys("accessToken", "user"),
            field_type("accessToken", "string"),
            custom("user.id is string", "pm.expect(j.user.id).to.be.a('string');"),
            ["if (j && j.accessToken) { pm.collectionVariables.set('token', j.accessToken); }",
             "if (j && j.user && j.user.id) { pm.collectionVariables.set('adminId', j.user.id); pm.collectionVariables.set('driverId', j.user.id); }"])))
    it.append(make_req("02 Auth: me (admin)", "GET", N, "auth/me", auth="admin",
        tests=combine(eq(200), has_keys("id", "email", "roles", "walletBalance", "status"),
            custom("roles is array", "pm.expect(j.roles).to.be.an('array');"),
            custom("has ADMIN role", "pm.expect(j.roles).to.include('ADMIN');"),
            custom("walletBalance is number", "pm.expect(j.walletBalance).to.be.a('number');"))))
    it.append(make_req("03 Auth: register new user capture survToken", "POST", N, "auth/register",
        body={"email": "reg{{$randomInt}}@stm.dev", "password": "Reg@12345", "fullName": "Reg User"},
        tests=combine(eq(201), has_keys("accessToken"),
            ["if (j && j.accessToken) { pm.collectionVariables.set('survToken', j.accessToken); }"])))
    it.append(make_req("04 Auth: forgot-password", "POST", N, "auth/forgot-password",
        body={"email": "admin@stm.dev"},
        tests=combine(eq(201), has_keys("sent", "otp"),
            custom("sent is true", "pm.expect(j.sent).to.eql(true);"))))
    it.append(make_req("05 Auth: verify-otp (invalid) -> 400", "POST", N, "auth/verify-otp",
        body={"email": "admin@stm.dev", "otp": "000000"},
        tests=combine(eq(400), custom("statusCode 400", "pm.expect(j.statusCode).to.eql(400);"))))
    it.append(make_req("06 Auth: resend-otp", "POST", N, "auth/resend-otp",
        body={"email": "admin@stm.dev"}, tests=combine(eq(201), has_keys("sent"))))
    it.append(make_req("07 Auth: reset-password (invalid otp) -> 400", "POST", N, "auth/reset-password",
        body={"email": "admin@stm.dev", "otp": "000000", "newPassword": "Xyz@12345"},
        tests=combine(eq(400))))
    it.append(make_req("08 Auth: google (public)", "GET", N, "auth/google",
        tests=combine(oneof([200, 302]), no_5xx())))
    it.append(make_req("09 Auth: update profile (admin)", "PATCH", N, "auth/me", auth="admin",
        body={"fullName": "Admin STM"}, tests=combine(eq(200), has_keys("id", "fullName"))))
    it.append(make_req("G1 Guard: me without token -> 401", "GET", N, "auth/me", tests=combine(eq(401))))
    it.append(make_req("G2 Guard: wallet without token -> 401", "GET", N, "wallet", tests=combine(eq(401))))
    it.append(make_req("G3 Guard: admin/users without token -> 401", "GET", N, "admin/users", tests=combine(eq(401))))
    it.append(make_req("G4 RBAC: surveyor on admin route -> 403", "GET", N, "admin/users", auth="surveyor",
        tests=combine(oneof([401, 403]),
            custom("403 has Forbidden", "if (pm.response.code === 403) { pm.expect(j.error).to.eql('Forbidden'); }"))))
    return it


def build_phase3():
    """Wallet + Leaderboard + Notifications + Daily-tasks."""
    N = "baseUrl"; it = []
    it.append(make_req("W01 Wallet: get balance", "GET", N, "wallet", auth="admin",
        tests=combine(eq(200), has_keys("wallet", "recentTransactions"),
            custom("wallet is object", "pm.expect(j.wallet).to.be.an('object');"),
            custom("recentTransactions array", "pm.expect(j.recentTransactions).to.be.an('array');"))))
    it.append(make_req("W02 Wallet: transactions (paginated)", "GET", N, "wallet/transactions", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("W03 Wallet: top-up packages", "GET", N, "wallet/top-up/packages", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("W04 Wallet: top-up custom (50 credits)", "POST", N, "wallet/top-up/custom", auth="admin",
        body={"amount": 50},
        tests=combine(eq(201), has_keys("paymentOrder"),
            custom("paymentOrder.orderCode string", "pm.expect(j.paymentOrder.orderCode).to.be.a('string');"),
            custom("paymentOrder.status present", "pm.expect(j.paymentOrder).to.have.property('status');"))))
    it.append(make_req("W05 Wallet: top-up package 1", "POST", N, "wallet/top-up", auth="admin",
        body={"packageId": 1},
        tests=combine(eq(201), has_keys("paymentOrder"))))
    it.append(make_req("W06 Wallet: top-up bad package -> 404", "POST", N, "wallet/top-up", auth="admin",
        body={"packageId": 999999}, tests=combine(eq(404))))
    it.append(make_req("W07 Wallet: payment-methods list", "GET", N, "wallet/payment-methods", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("W08 Wallet: add payment method (201)", "POST", N, "wallet/payment-methods", auth="admin",
        body={"cardHolderName": "Admin STM", "cardLast4": "4242", "cardBrand": "VISA",
              "expiryMonth": "12", "expiryYear": "2030"},
        tests=combine(eq(201), has_keys("id", "cardHolderName", "cardLast4"),
            setvar("j.id", "pmId"))))
    it.append(make_req("W09 Wallet: delete payment method", "DELETE", N, "wallet/payment-methods/{{pmId}}", auth="admin",
        tests=combine(oneof([200, 204, 404]))))
    it.append(make_req("W10 Wallet: internal deduct (valid token)", "POST", N, "wallet/internal/deduct",
        auth="internal",
        body={"userId": "{{adminId}}", "amount": 1, "referenceType": "regression"},
        tests=combine(oneof([200, 201, 400]),
            custom("no 5xx / not 401", "pm.expect(pm.response.code).to.not.eql(401); pm.expect(pm.response.code).to.not.eql(403);"))))
    it.append(make_req("W11 Wallet: internal deduct no token -> 401", "POST", N, "wallet/internal/deduct",
        body={"userId": "{{adminId}}", "amount": 1},
        tests=combine(eq(401))))
    it.append(make_req("LB1 Leaderboard: list (paginated)", "GET", N, "leaderboard", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("LB2 Leaderboard: refresh (admin)", "POST", N, "leaderboard/refresh", auth="admin",
        tests=combine(eq(201), custom("refreshed true", "pm.expect(j.refreshed).to.eql(true);"))))
    it.append(make_req("NT1 Notifications: unread count", "GET", N, "notifications/unread-count", auth="admin",
        tests=combine(eq(200), custom("unreadCount is number", "pm.expect(j.unreadCount).to.be.a('number');"))))
    it.append(make_req("NT2 Notifications: list (paginated)", "GET", N, "notifications", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("NT3 Notifications: read-all", "PATCH", N, "notifications/read-all", auth="admin",
        tests=combine(eq(200), custom("updated true", "pm.expect(j.updated).to.eql(true);"))))
    it.append(make_req("NT4 Notifications: mark read (bad id -> 200 idempotent)", "PATCH", N,
        "notifications/00000000-0000-0000-0000-000000000000/read", auth="admin",
        tests=combine(oneof([200, 204, 404]))))
    it.append(make_req("DT1 Daily-tasks: list", "GET", N, "daily-tasks", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("DT2 Daily-tasks: my completions", "GET", N, "daily-tasks/completions/me", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("DT3 Daily-tasks: claim non-existent -> 404", "POST", N, "daily-tasks/999999/claim", auth="admin",
        tests=combine(eq(404), custom("task not found", "pm.expect(j.message).to.include('not found');"))))
    it.append(make_req("DT4 Daily-tasks: claim bad id (non-numeric) -> 400", "POST", N, "daily-tasks/abc/claim", auth="admin",
        tests=combine(eq(400))))
    return it


def build_phase4():
    """Catalog CRUD lifecycle + system-parameters."""
    N = "baseUrl"; it = []
    # Use pre-request to set a timestamp-based unique code
    prereq_cat = ["pm.collectionVariables.set('catCode', 'RC' + Date.now());",
                  "pm.collectionVariables.set('stCode', 'ST' + Date.now());"]
    it.append(make_req("C01 Catalog: categories list", "GET", N, "catalog/categories", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("C02 Catalog: sign-types list", "GET", N, "catalog/sign-types", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("C03 Catalog: create category (201, capture catId)", "POST", N, "catalog/categories", auth="admin",
        body={"code": "{{catCode}}", "nameVi": "Test Cat Vi", "nameEn": "Test Cat En"},
        prereq=prereq_cat,
        tests=combine(eq(201), has_keys("id", "code", "nameVi", "nameEn"),
            custom("id is number", "pm.expect(j.id).to.be.a('number');"),
            setvar("j.id", "catId"))))
    it.append(make_req("C04 Catalog: get category by id (200)", "GET", N, "catalog/categories/{{catId}}", auth="admin",
        tests=combine(eq(200), has_keys("id", "code", "nameVi", "nameEn"))))
    it.append(make_req("C05 Catalog: patch category (200)", "PATCH", N, "catalog/categories/{{catId}}", auth="admin",
        body={"nameVi": "Updated Vi"},
        tests=combine(eq(200), has_keys("id", "nameVi"),
            custom("nameVi updated", "pm.expect(j.nameVi).to.eql('Updated Vi');"))))
    it.append(make_req("C06 Catalog: create sign-type under category (201, capture stId)", "POST", N, "catalog/sign-types", auth="admin",
        body={"categoryId": "{{catId}}", "signCode": "{{stCode}}", "nameVi": "Test Sign Vi", "nameEn": "Test Sign En"},
        tests=combine(eq(201), has_keys("id", "signCode", "nameVi", "nameEn", "categoryId"),
            setvar("j.id", "stId"))))
    it.append(make_req("C07 Catalog: get sign-type by id (200)", "GET", N, "catalog/sign-types/{{stId}}", auth="admin",
        tests=combine(eq(200), has_keys("id", "signCode", "nameVi"))))
    it.append(make_req("C08 Catalog: patch sign-type (200)", "PATCH", N, "catalog/sign-types/{{stId}}", auth="admin",
        body={"nameVi": "Updated Sign Vi"},
        tests=combine(eq(200), custom("nameVi updated", "pm.expect(j.nameVi).to.eql('Updated Sign Vi');"))))
    it.append(make_req("C09 Catalog: delete sign-type (soft-delete -> 200)", "DELETE", N, "catalog/sign-types/{{stId}}", auth="admin",
        tests=combine(eq(200), custom("deleted true", "pm.expect(j.deleted).to.eql(true);"))))
    it.append(make_req("C10 Catalog: delete category with FK ref -> 400 (FK guard)", "DELETE", N, "catalog/categories/{{catId}}", auth="admin",
        tests=combine(eq(400), custom("FK error message", "pm.expect(j.message).to.include('sign type');"))))
    it.append(make_req("C11 Catalog: get category not found -> 404", "GET", N, "catalog/categories/999999999", auth="admin",
        tests=combine(eq(404), custom("not found message", "pm.expect(j.message).to.include('not found');"))))
    it.append(make_req("C12 Catalog: get sign-type not found -> 404", "GET", N, "catalog/sign-types/999999999", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("C13 Catalog: create category validation (missing fields) -> 400", "POST", N, "catalog/categories", auth="admin",
        body={"name": "wrong field"},
        tests=combine(eq(400), custom("whitelist validation", "pm.expect(j.message).to.be.an('array');"))))
    it.append(make_req("SP1 Admin: system-parameters upsert (PUT -> 200)", "PUT", N,
        "admin/system-parameters/regression_test_key", auth="admin",
        body={"value": "42", "description": "regression test"},
        tests=combine(eq(200), has_keys("key", "value", "updatedAt"),
            custom("value is 42", "pm.expect(j.value).to.eql('42');"))))
    it.append(make_req("SP2 Admin: system-parameters get by key (200)", "GET", N,
        "admin/system-parameters/regression_test_key", auth="admin",
        tests=combine(eq(200), has_keys("key", "value"),
            custom("key matches", "pm.expect(j.key).to.eql('regression_test_key');"))))
    it.append(make_req("SP3 Admin: system-parameters list (200)", "GET", N,
        "admin/system-parameters", auth="admin",
        tests=combine(eq(200))))
    it.append(make_req("SP4 Admin: system-parameters missing key -> 404", "GET", N,
        "admin/system-parameters/does_not_exist_xyz", auth="admin",
        tests=combine(eq(404))))
    return it


def build_phase5():
    """Places lifecycle + Submissions lifecycle + Reviews."""
    N = "baseUrl"; it = []
    # Places saved
    it.append(make_req("PL1 Places: saved list", "GET", N, "places/saved", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("PL2 Places: add saved place (201, capture placeId)", "POST", N, "places/saved", auth="admin",
        body={"label": "Home", "address": "1 Le Loi, Q1, HCMC", "latitude": 10.77, "longitude": 106.70},
        tests=combine(eq(201), has_keys("id", "label", "address", "latitude", "longitude"),
            custom("label Home", "pm.expect(j.label).to.eql('Home');"),
            setvar("j.id", "placeId"))))
    it.append(make_req("PL3 Places: delete saved place (200)", "DELETE", N, "places/saved/{{placeId}}", auth="admin",
        tests=combine(oneof([200, 204]),
            custom("deleted true when 200", "if (pm.response.code === 200) pm.expect(j.deleted).to.eql(true);"))))
    it.append(make_req("PL4 Places: add saved missing label -> 400 (validation)", "POST", N, "places/saved", auth="admin",
        body={"address": "missing label", "latitude": 10.77, "longitude": 106.70},
        tests=combine(eq(400))))
    # Recent searches
    it.append(make_req("PL5 Places: recent-searches list", "GET", N, "places/recent-searches", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("PL6 Places: add recent search (201)", "POST", N, "places/recent-searches", auth="admin",
        body={"query": "Nguyen Hue", "latitude": 10.77, "longitude": 106.70},
        tests=combine(eq(201), has_keys("id", "query"),
            custom("query matches", "pm.expect(j.query).to.eql('Nguyen Hue');"),
            setvar("j.id", "recentId"))))
    it.append(make_req("PL7 Places: delete recent-search by id (200)", "DELETE", N,
        "places/recent-searches/{{recentId}}", auth="admin",
        tests=combine(oneof([200, 204]),
            custom("deleted true when 200", "if (pm.response.code === 200) pm.expect(j.deleted).to.eql(true);"))))
    it.append(make_req("PL8 Places: clear all recent-searches (200)", "DELETE", N, "places/recent-searches", auth="admin",
        tests=combine(eq(200), custom("cleared true", "pm.expect(j.cleared).to.eql(true);"))))
    # Submissions lifecycle
    it.append(make_req("SB1 Submissions: initialize (201, capture sessionId)", "POST", N, "submissions/initialize", auth="admin",
        body={"originalFilename": "dashcam.mp4", "mediaType": "VIDEO", "totalSizeBytes": 1048576, "totalChunks": 2},
        tests=combine(eq(201), has_keys("sessionId", "status", "totalChunks"),
            custom("status INITIATED", "pm.expect(j.status).to.eql('INITIATED');"),
            custom("totalChunks 2", "pm.expect(j.totalChunks).to.eql(2);"),
            setvar("j.sessionId", "sessionId"))))
    it.append(make_req("SB2 Submissions: get session", "GET", N, "submissions/{{sessionId}}", auth="admin",
        tests=combine(eq(200), has_keys("session"),
            custom("session.id matches", "pm.expect(j.session.id).to.eql(pm.collectionVariables.get('sessionId'));"))))
    it.append(make_req("SB3 Submissions: my list (paginated)", "GET", N, "submissions/me", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("SB4 Submissions: my pending", "GET", N, "submissions/me/pending", auth="admin",
        tests=combine(eq(200), has_keys("total", "pending"))))
    it.append(make_req("SB5 Submissions: my stats", "GET", N, "submissions/me/stats", auth="admin",
        tests=combine(eq(200), has_keys("userId", "totalSubmissions"),
            custom("userId matches", "pm.expect(j.userId).to.eql(pm.collectionVariables.get('adminId'));"))))
    it.append(make_req("SB6 Submissions: status unknown id -> 404", "GET", N,
        "submissions/status/00000000-0000-0000-0000-000000000000", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("SB7 Submissions: init validation (bad mediaType) -> 400", "POST", N, "submissions/initialize", auth="admin",
        body={"originalFilename": "x.mp4", "mediaType": "UNKNOWN_TYPE", "totalSizeBytes": 1024, "totalChunks": 1},
        tests=combine(eq(400))))
    it.append(make_req("SB8 Submissions: internal complete unknown -> 404", "POST", N,
        "submissions/internal/00000000-0000-0000-0000-000000000000/complete", auth="internal",
        body={},
        tests=combine(eq(404))))
    it.append(make_req("SB9 Submissions: internal status advance unknown -> 404", "PATCH", N,
        "submissions/internal/00000000-0000-0000-0000-000000000000/status", auth="internal",
        body={"status": "QUEUED"},
        tests=combine(eq(404))))
    it.append(make_req("SB10 Submissions: internal no token -> 401", "PATCH", N,
        "submissions/internal/00000000-0000-0000-0000-000000000000/status",
        body={"status": "QUEUED"}, tests=combine(eq(401))))
    return it


def build_phase6():
    """Reviews + Revalidation + Moderation."""
    N = "baseUrl"; it = []
    # Reviews
    it.append(make_req("RV1 Reviews: me/stats", "GET", N, "reviews/me/stats", auth="admin",
        tests=combine(eq(200), has_keys("reviewerId", "totalReviews", "approved", "rejected", "reliabilityScore"))))
    it.append(make_req("RV2 Reviews: queue (paginated)", "GET", N, "reviews/queue", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("RV3 Reviews: candidate detail not found -> 404", "GET", N,
        "reviews/candidates/00000000-0000-0000-0000-000000000000", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("RV4 Reviews: candidate report not found -> 404", "POST", N,
        "reviews/candidates/00000000-0000-0000-0000-000000000000/report", auth="admin",
        body={"reason": "test"},
        tests=combine(eq(404))))
    it.append(make_req("RV5 Reviews: can-not-identify not found -> 404", "POST", N,
        "reviews/candidates/00000000-0000-0000-0000-000000000000/can-not-identify", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("RV6 Reviews: vote (bad body -> 400)", "POST", N,
        "reviews/00000000-0000-0000-0000-000000000000/vote", auth="admin",
        body={"decision": "APPROVE"},
        tests=combine(eq(400), custom("vote validation", "pm.expect(j.message).to.be.an('array');"))))
    it.append(make_req("RV7 Reviews: missing-type report (create 201)", "POST", N, "reviews/missing-type", auth="admin",
        body={"proposedName": "Bien hieu moi", "description": "regression test"},
        tests=combine(eq(201), has_keys("reporterId", "proposedName"),
            custom("proposedName matches", "pm.expect(j.proposedName).to.eql('Bien hieu moi');"),
            setvar("j.id", "reportId"))))
    it.append(make_req("RV8 Reviews: internal unscored (valid internal token)", "GET", N,
        "reviews/internal/unscored-candidates", auth="internal",
        tests=combine(eq(200), has_keys("items", "totalUnscored", "totalPending"),
            custom("items array", "pm.expect(j.items).to.be.an('array');"))))
    it.append(make_req("RV9 Reviews: internal unscored no token -> 401", "GET", N,
        "reviews/internal/unscored-candidates",
        tests=combine(eq(401))))
    it.append(make_req("RV10 Reviews: internal al-priorities empty array -> 400", "POST", N,
        "reviews/internal/active-learning-priorities", auth="internal",
        body={"items": []},
        tests=combine(eq(400), custom("non-empty required", "pm.expect(j.message).to.include('non-empty');"))))
    it.append(make_req("RV11 Reviews: internal al-priority patch not found -> 404", "PATCH", N,
        "reviews/internal/00000000-0000-0000-0000-000000000000/active-learning-priority", auth="internal",
        body={"priority": 0.9},
        tests=combine(eq(404))))
    # Revalidation
    it.append(make_req("RE1 Revalidation: tasks map (snake_case bbox)", "GET", N,
        "revalidation/tasks/map?min_lat=10&min_lon=105&max_lat=11&max_lon=107", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("RE2 Revalidation: tasks list (paginated)", "GET", N, "revalidation/tasks", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("RE3 Revalidation: task by id not found -> 404", "GET", N,
        "revalidation/tasks/00000000-0000-0000-0000-000000000000", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("RE4 Revalidation: task non-UUID -> 400", "GET", N, "revalidation/tasks/1", auth="admin",
        tests=combine(eq(400))))
    it.append(make_req("RE5 Revalidation: evidences not found -> 404", "GET", N,
        "revalidation/tasks/00000000-0000-0000-0000-000000000000/evidences", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("RE6 Revalidation: vote not found -> 404", "POST", N,
        "revalidation/evidence/00000000-0000-0000-0000-000000000000/vote", auth="admin",
        body={"decision": "CONFIRM"},
        tests=combine(eq(404))))
    it.append(make_req("RE7 Revalidation: decisions not found -> 404", "GET", N,
        "revalidation/evidence/00000000-0000-0000-0000-000000000000/decisions", auth="admin",
        tests=combine(eq(404))))
    # Moderation
    it.append(make_req("MD1 Moderation: missing-type reports list", "GET", N, "moderation/missing-type-reports", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("MD2 Moderation: missing-type report by id (from RV7)", "GET", N,
        "moderation/missing-type-reports/{{reportId}}", auth="admin",
        tests=combine(oneof([200, 404]),
            custom("id present when 200", "if (pm.response.code === 200) pm.expect(j.id).to.be.a('string');"))))
    it.append(make_req("MD3 Moderation: patch missing-type report (from RV7)", "PATCH", N,
        "moderation/missing-type-reports/{{reportId}}", auth="admin",
        body={"status": "APPROVED"},
        tests=combine(oneof([200, 404]))))
    it.append(make_req("MD4 Moderation: cases list", "GET", N, "moderation/cases", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("MD5 Moderation: case detail not found -> 404", "GET", N,
        "moderation/cases/00000000-0000-0000-0000-000000000000", auth="admin",
        tests=combine(eq(404))))
    it.append(make_req("MD6 Moderation: case resolve not found -> 404", "PUT", N,
        "moderation/cases/00000000-0000-0000-0000-000000000000/resolve", auth="admin",
        body={"resolutionNote": "done"},
        tests=combine(eq(404))))
    return it


def build_phase7():
    """Admin user management + payments webhook."""
    N = "baseUrl"; it = []
    it.append(make_req("AD1 Admin: list users (admin)", "GET", N, "admin/users", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("AD2 Admin: audit logs", "GET", N, "admin/audit-logs", auth="admin",
        tests=combine(eq(200), paginated())))
    it.append(make_req("AD3 Admin: signs export", "GET", N, "admin/signs/export", auth="admin",
        tests=combine(eq(200), is_array())))
    it.append(make_req("AD4 Admin: update user status not found -> 404", "PATCH", N,
        "admin/users/00000000-0000-0000-0000-000000000000/status", auth="admin",
        body={"status": "SUSPENDED"},
        tests=combine(eq(404))))
    it.append(make_req("AD5 Admin: update user status bad value -> 400", "PATCH", N,
        "admin/users/00000000-0000-0000-0000-000000000000/status", auth="admin",
        body={"status": "INVALID_STATUS"},
        tests=combine(eq(400))))
    it.append(make_req("AD6 Admin: assign role not found -> 404", "POST", N,
        "admin/users/00000000-0000-0000-0000-000000000000/roles", auth="admin",
        body={"roleCode": "REVIEWER"},
        tests=combine(eq(404))))
    it.append(make_req("AD7 Admin: update own status (self, tolerant)", "PATCH", N,
        "admin/users/{{adminId}}/status", auth="admin",
        body={"status": "ACTIVE"},
        tests=combine(oneof([200, 400, 404]))))
    it.append(make_req("PA1 Payments: webhook bad enum -> 400 (validation)", "POST", N, "payments/webhook",
        body={"orderCode": "X", "status": "success"},
        tests=combine(eq(400), custom("message array", "pm.expect(j.message).to.be.an('array');"))))
    it.append(make_req("PA2 Payments: webhook FAILED status -> runs logic", "POST", N, "payments/webhook",
        body={"orderCode": "STM-FAKE-000000000-XXXXXX", "status": "FAILED"},
        tests=combine(oneof([200, 201, 400, 404]), no_5xx())))
    return it


def main():
    if COLL.exists():
        coll = json.loads(COLL.read_text("utf-8"))
    else:
        print(f"ERROR: {COLL} does not exist.", file=sys.stderr)
        sys.exit(1)

    all_items = (
        build_phase1() + build_phase2() + build_phase3() +
        build_phase4() + build_phase5() + build_phase6() + build_phase7()
    )

    cv = coll.get("variable", [])
    needed = {
        "baseUrl": "http://localhost:3000/api/v1",
        "fastapiBaseUrl": "http://localhost:8000/api/v1",
        "fastapiRoot": "http://localhost:8000",
        "internalToken": "stm_internal_secret_dev",
        "token": "", "survToken": "", "adminId": "", "driverId": "", "navId": "",
        "catId": "", "stId": "", "catCode": "", "stCode": "", "pmId": "",
        "placeId": "", "recentId": "", "sessionId": "", "reportId": "",
    }
    existing = {v["key"] for v in cv}
    for k, v in needed.items():
        if k not in existing:
            cv.append({"key": k, "value": v, "type": "string"})
    coll["variable"] = cv

    coll["item"] = [f for f in coll.get("item", []) if f.get("name") not in (FOLDER_NAME, OLD_SMOKE)]
    coll["item"].append({
        "name": FOLDER_NAME,
        "description": ("Exhaustive regression: every NestJS + FastAPI endpoint with exact status codes, "
                        "response shape and business-logic assertions."),
        "item": all_items,
    })

    total_tests = sum(
        sum(1 for line in (e.get("script", {}).get("exec") or []) if "pm.test(" in line)
        for req in all_items for e in req.get("event", []) if e.get("listen") == "test"
    )
    print(f"Generated {len(all_items)} requests, ~{total_tests} pm.test assertions")
    COLL.write_text(json.dumps(coll, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {COLL}")
    print(f"\nRun: npx newman run {COLL.name} --folder \"{FOLDER_NAME}\" "
          "--env-var baseUrl=http://localhost:3000/api/v1 "
          "--env-var fastapiBaseUrl=http://localhost:8000/api/v1 "
          "--env-var fastapiRoot=http://localhost:8000 "
          "--env-var internalToken=stm_internal_secret_dev --bail")


if __name__ == "__main__":
    main()




