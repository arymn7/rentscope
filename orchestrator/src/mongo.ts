import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "utrahacks";

let client: MongoClient | null = null;

export async function getDb() {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
  }
  return client.db(DB_NAME);
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
  }
}
