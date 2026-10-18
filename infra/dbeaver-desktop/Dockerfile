FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies, download and install latest DBeaver CE Debian package, and clean up apt cache
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget \
        ca-certificates \
        openjdk-17-jre \
        libswt-gtk-4-jni \
        libswt-gtk-4-java && \
    wget -q https://dbeaver.io/files/dbeaver-ce_latest_amd64.deb -O /tmp/dbeaver-ce.deb && \
    apt-get install -y --no-install-recommends /tmp/dbeaver-ce.deb && \
    rm -f /tmp/dbeaver-ce.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Configure autostart for XFCE session
RUN mkdir -p /etc/xdg/autostart && \
    cp /usr/share/applications/dbeaver-ce.desktop /etc/xdg/autostart/dbeaver-ce.desktop && \
    sed -i 's/^Exec=.*/Exec=env NO_AT_BRIDGE=1 \/usr\/share\/dbeaver-ce\/dbeaver/' /etc/xdg/autostart/dbeaver-ce.desktop

# Add custom cont-init script to configure desktop shortcut in user workspace
COPY init-dbeaver.sh /custom-cont-init.d/01-dbeaver-desktop.sh
RUN chmod +x /custom-cont-init.d/01-dbeaver-desktop.sh
