#!/usr/bin/env python3
"""
Discord Webhook Notifier for Schemathesis Failure Testing
Sends rich embeds to Discord when API failure or 500 crashes are detected.
"""
import os
import sys
import re
import json
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "").strip()

ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

def strip_ansi(text: str) -> str:
    return ANSI_ESCAPE.sub("", text)

def extract_failure_snippet(log_file: str) -> str:
    if not os.path.exists(log_file):
        return "No log file found."

    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    clean_content = strip_ansi(content)

    # Search for FAILURES section in schemathesis output
    if "=== FAILURES ===" in clean_content or "FAILURES" in clean_content:
        parts = clean_content.split("FAILURES", 1)
        snippet = parts[1]
        # End at SUMMARY if present
        if "=== SUMMARY ===" in snippet:
            snippet = snippet.split("=== SUMMARY ===")[0]
    else:
        # Fallback to the last 25 lines
        lines = clean_content.strip().splitlines()
        snippet = "\n".join(lines[-25:]) if lines else "Empty log."

    snippet = snippet.strip()
    if len(snippet) > 950:
        snippet = snippet[:950] + "\n... [truncated]"

    return snippet if snippet else "No failure details extracted."

def send_alert(service_name: str, status: str, log_file: str):
    if not WEBHOOK_URL:
        print(f"[Discord] No DISCORD_WEBHOOK_URL configured. Skipping notification for {service_name}.")
        return

    is_failed = status.upper() == "FAILED"
    snippet = extract_failure_snippet(log_file) if is_failed else ""

    if is_failed:
        embed = {
            "title": f"🚨 [Coolify] API Failure Detected: {service_name}",
            "description": f"Schemathesis detected unhandled exceptions (`500 Server Error`) during automated testing.",
            "color": 15158332,  # Red (0xE74C3C)
            "fields": [
                {"name": "Target Service", "value": f"`{service_name}`", "inline": True},
                {"name": "Status", "value": "❌ **FAILED (500 Caught)**", "inline": True},
                {
                    "name": "Failure Details & Reproduction",
                    "value": f"```text\n{snippet}\n```",
                    "inline": False,
                },
            ],
            "footer": {"text": "SignTrustMap • Coolify Sentinel"},
        }
    else:
        embed = {
            "title": f"✅ [Coolify] All Endpoints Healthy: {service_name}",
            "description": f"Schemathesis finished testing `{service_name}` endpoints with **0 crashes**.",
            "color": 3066993,  # Green (0x2ECC71)
            "fields": [
                {"name": "Target Service", "value": f"`{service_name}`", "inline": True},
                {"name": "Status", "value": "🟢 **PASSED**", "inline": True},
            ],
            "footer": {"text": "SignTrustMap • Coolify Sentinel"},
        }

    payload = {
        "username": "SignTrustMap Sentinel",
        "avatar_url": "https://raw.githubusercontent.com/grafana/grafana/main/public/img/grafana_icon.svg",
        "embeds": [embed],
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = Request(
            WEBHOOK_URL,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "SignTrustMap-Sentinel/1.0",
            },
            method="POST",
        )
        with urlopen(req, timeout=10) as resp:
            if resp.status in (200, 204):
                print(f"[Discord] Successfully delivered alert for {service_name}.")
    except (HTTPError, URLError, Exception) as e:
        print(f"[Discord] Warning: Failed to send webhook: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: notify-discord.py <service_name> <SUCCESS|FAILED> [log_path]")
        sys.exit(1)

    target_service = sys.argv[1]
    target_status = sys.argv[2]
    target_log = sys.argv[3] if len(sys.argv) > 3 else ""
    send_alert(target_service, target_status, target_log)
