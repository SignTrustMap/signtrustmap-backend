#!/bin/bash
set -e

# Ensure Desktop directory exists for the user in /config
mkdir -p /config/Desktop

# Copy desktop shortcut
if [ -f /usr/share/applications/dbeaver-ce.desktop ]; then
    cp /usr/share/applications/dbeaver-ce.desktop /config/Desktop/dbeaver-ce.desktop
    chmod +x /config/Desktop/dbeaver-ce.desktop
    chown -R 1000:1000 /config/Desktop 2>/dev/null || true
fi
