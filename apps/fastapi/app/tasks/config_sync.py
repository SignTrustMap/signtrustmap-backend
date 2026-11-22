import asyncio
import json
import logging
import redis.asyncio as aioredis
from app.config import settings

logger = logging.getLogger("config_sync")

async def listen_parameter_updates():
    """
    Subscribes to Redis Pub/Sub channel 'system:parameter:updated'
    and dynamically hot-reloads runtime parameters into FastAPI settings in memory.
    """
    try:
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        pubsub = redis_client.pubsub()
        await pubsub.subscribe("system:parameter:updated")
        logger.info("Subscribed to Redis channel 'system:parameter:updated' for live config hot-reloading.")

        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    key = data.get("key")
                    val = data.get("value")
                    logger.info(f"Received hot-reload update: {key} = {val}")

                    if key == "navigation.search_radius_m":
                        settings.NAVIGATION_SEARCH_RADIUS_M = int(val)
                    elif key == "navigation.heading_threshold_deg":
                        settings.NAVIGATION_HEADING_THRESHOLD_DEG = float(val)
                except Exception as e:
                    logger.error(f"Failed to process parameter update payload: {e}")
    except asyncio.CancelledError:
        logger.info("Parameter update listener task cancelled on shutdown.")
    except Exception as e:
        logger.warning(f"Redis parameter sync error (offline or unreachable): {e}")
