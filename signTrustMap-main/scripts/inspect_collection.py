import json
d = json.load(open("STM_Full.postman_collection.json", encoding="utf-8"))
print("=== COLLECTION VARIABLES ===")
for v in d.get("variable", []):
    print(f"  {v.get('key')} = {v.get('value')}")
print("\n=== TOP-LEVEL FOLDERS ===")
for it in d["item"]:
    subs = it.get("item", [])
    ntests = 0
    nreq = 0
    for r in subs:
        if "request" in r:
            nreq += 1
        elif "item" in r:  # nested folder
            for rr in r["item"]:
                nreq += 1
        ev = r.get("event", [])
        has_test = any(e.get("listen") == "test" for e in ev)
        if has_test:
            ntests += 1
    print(f"  {it['name']}: {len(subs)} sub-items, requests={nreq}, with_test_event={ntests}")
