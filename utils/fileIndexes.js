import mongoose from "mongoose";

export async function createFileIndexes() {
    try {
        const db = mongoose.connection.db;
        const filesCollection = db.collection("uploads.files");
        await filesCollection.createIndex({
            "metadata.userId": 1,
            "metadata.isPublic": 1,
            "metadata.publicExpiresAt": 1
        });
        console.log("Indexes created successfully");
    } catch (error) {
        console.error("Error creating indexes:", error);
    }
}
