# ---------------- Load text from MongoDB ----------------
async def load_blob_from_mongo(collection, learning_path_title: str) -> str:
    """
    Load the large text/blob for a given learning path from MongoDB.
    """
    doc = await collection.find_one({"title": learning_path_title})
    if doc and "description" in doc:
        return doc["description"]
    return ""
