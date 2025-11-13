# backend/redis_cache.py
import redis
import os
import pickle
from dotenv import load_dotenv

load_dotenv()
REDIS_URL = os.getenv("REDIS_URL")
r = redis.Redis.from_url(REDIS_URL)

def cache_set(key: str, value, expire: int = None):
    """Cache a Python object in Redis."""
    if expire is None:
        r.set(key, pickle.dumps(value))  # no expiration
    else:
        r.set(key, pickle.dumps(value), ex=expire)


def cache_get(key: str):
    """Retrieve a Python object from Redis."""
    value = r.get(key)
    if value is None:
        return None
    return pickle.loads(value)
