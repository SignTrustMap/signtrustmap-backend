import re, glob, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "nestjs", "src", "modules"))
for f in sorted(glob.glob("**/*.controller.ts", recursive=True)):
    s = open(f, encoding="utf-8").read()
    m = re.search(r"@Controller\(['\"]?([^'\"]*?)['\"]?\)", s)
    base = m.group(1).strip("/") if m else ""
    print(f"### {f}  base='{base}'")
    # find each decorator with its preceding guard/roles context
    for d in re.finditer(r"@(Get|Post|Patch|Put|Delete|All)\(\s*['\"]?([^'\"]*?)['\"]?\s*\)", s):
        verb = d.group(1).upper()
        sub = d.group(2).strip("/")
        path = "/".join([p for p in [base, sub] if p])
        # look back ~400 chars for Public / InternalTokenGuard / Roles
        pre = s[max(0, d.start() - 400):d.start()]
        flags = []
        if re.search(r"@Public\(\)", pre): flags.append("PUBLIC")
        if "InternalTokenGuard" in pre: flags.append("INTERNAL")
        rm = re.findall(r"@Roles\(\s*([^)]*)\)", pre)
        if rm: flags.append("ROLES=" + rm[-1].replace("'", "").strip())
        print(f"   {verb:6} {path:55} {' '.join(flags)}")
