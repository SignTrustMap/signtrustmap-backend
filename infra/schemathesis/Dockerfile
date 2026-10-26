FROM schemathesis/schemathesis:latest

USER root
WORKDIR /app

COPY run-tests.sh /app/run-tests.sh
COPY notify-discord.py /app/notify-discord.py

RUN chmod +x /app/run-tests.sh /app/notify-discord.py

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["while true; do /bin/sh /app/run-tests.sh; echo \"Sleeping for ${SCAN_INTERVAL_SECONDS:-3600} seconds before next hourly test...\"; sleep ${SCAN_INTERVAL_SECONDS:-3600}; done"]
