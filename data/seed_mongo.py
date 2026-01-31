import json
import os
from datetime import datetime
from pymongo import MongoClient

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "utrahacks")

with open(os.path.join(os.path.dirname(__file__), "sample", "seed_demo.json"), "r") as f:
    payload = json.load(f)

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

db.shortlists.insert_one({
    "candidates": payload["candidates"],
    "preferences": payload["preferences"],
    "createdAt": datetime.utcnow()
})

print("Seeded shortlists collection with demo data")
