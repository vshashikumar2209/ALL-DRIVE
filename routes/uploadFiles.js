import multer from "multer";
import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "stream";
import dotenv from "dotenv";
import mongoose from "mongoose";
import foldermodel from "../models/folder.js";
import crypto, { randomBytes } from "crypto";
import argon2 from "argon2"; //for password creation
import activityModel from "../models/activityModel.js";

dotenv.config();
const upload = multer({ storage: multer.memoryStorage() });

export const middlewareUpload = upload.array('files');

// Lazy Mongo client and bucket initialization to avoid crashing when MONGO_URI is missing at import time
// let client;
let bucket = null;
export async function ensureBucket() {
    if (bucket) return bucket;

    const db = mongoose.connection.db;
    bucket = new GridFSBucket(db, { bucketName: "uploads" });
    return bucket;
}
// function deriveFileKey(userId, salt) {
//     return crypto.scryptSync(
//         process.env.FILE_KEY_MASTER,
//         Buffer.concat([Buffer.from(String(userId)), salt]),//userId is Object in mongodb
//         32
//     )
// }
// if (!process.env.FILE_KEY_MASTER) {
//     throw new Error("File key master not found");
// }    
export function encryptKey(key, masterKey) {
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([
        cipher.update(key),
        cipher.final()
    ])
    return {
        encryptedKey: encrypted,
        iv,
        authTag: cipher.getAuthTag()
    };
}

export async function deriveUserMasterKey(password, salt) {
    // Ensure salt is a Buffer, assuming it's stored as hex
    const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');

    // console.log("deriveUserMasterKey Debug:", {
    //     passwordType: typeof password,
    //     passwordLength: password ? password.length : 0,
    //     saltInputType: typeof salt,
    //     saltIsBuffer: Buffer.isBuffer(salt),
    //     saltHexLength: salt && typeof salt === 'string' ? salt.length : 'N/A',
    //     saltBufferLength: saltBuffer.length
    // });

    try {
        return await argon2.hash(password, {
            type: argon2.argon2id,
            salt: saltBuffer,
            hashLength: 32,
            timeCost: 3,
            memoryCost: 2 ** 16,
            parallelism: 1,
            raw: true
        });
    } catch (err) {
        console.error("Argon2 execution failed:", err);
        throw err;
    }
}


export async function uploadFiles(req, res) {
    try {
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).send("No files uploaded");
        }

        if (!req.session?.userMasterKey) {
            return res.status(401).json({ error: "Session expired. Please login again" });
        }

        const conflictAction = req.body.conflictAction; // 'keep_both', 'replace', 'update_version'
        const targetPath = req.body.path || '';

        // Pre-process files to check for conflicts and determine final filenames and versions
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const existingFile = await filesCollection.findOne({
                "metadata.userId": req.user.id,
                "metadata.path": targetPath,
                filename: file.originalname
            });

            file.versionGroupId = new mongoose.Types.ObjectId().toString();
            file.metadata_version = 1;

            if (existingFile) {
                if (!conflictAction) {
                    return res.status(409).json({ error: "FileExists", filename: file.originalname });
                }

                if (conflictAction === 'keep_both') {
                    let counter = 1;
                    let newFilename = '';
                    const parts = file.originalname.split('.');
                    const ext = parts.length > 1 ? `.${parts.pop()}` : '';
                    const base = parts.join('.');
                    
                    while (true) {
                        newFilename = `${base} (${counter})${ext}`;
                        const checkCopy = await filesCollection.findOne({
                            "metadata.userId": req.user.id,
                            "metadata.path": targetPath,
                            filename: newFilename
                        });
                        if (!checkCopy) break;
                        counter++;
                    }
                    file.originalname = newFilename;

                } else if (conflictAction === 'replace') {
                    const existingFiles = await filesCollection.find({
                        "metadata.userId": req.user.id,
                        "metadata.path": targetPath,
                        filename: file.originalname
                    }).toArray();
                    
                    for (const f of existingFiles) {
                        try { await bucket.delete(f._id); } catch(e) {}
                    }

                } else if (conflictAction === 'update_version') {
                    file.versionGroupId = existingFile.metadata.fileGroupId || existingFile._id.toString();
                    
                    const allVersions = await filesCollection.find({
                        "metadata.userId": req.user.id,
                        "metadata.path": targetPath,
                        "metadata.fileGroupId": file.versionGroupId
                    }).toArray();
                    
                    let maxVer = existingFile.metadata.version || 1;
                    for (const v of allVersions) {
                        if (v.metadata && v.metadata.version > maxVer) maxVer = v.metadata.version;
                    }
                    
                    // Add version metadata to existing file if missing
                    if (!existingFile.metadata.fileGroupId) {
                        await filesCollection.updateOne({ _id: existingFile._id }, {
                            $set: {
                                "metadata.fileGroupId": file.versionGroupId,
                                "metadata.version": 1
                            }
                        });
                    }
                    file.metadata_version = maxVer + 1;
                }
            }
        }

        const USER_MASTER_KEY = Buffer.from(req.session.userMasterKey, 'hex');

        const uploadPromises = files.map(file => {

            return new Promise((resolve, reject) => {

                const iv = crypto.randomBytes(12);
                const fileKey = crypto.randomBytes(32);

                const cipher = crypto.createCipheriv('aes-256-gcm', fileKey, iv);

                const encryptedFileKey = encryptKey(fileKey, USER_MASTER_KEY);

                const uploadStream = bucket.openUploadStream(file.originalname, {
                    contentType: file.mimetype,
                    metadata: {
                        userId: req.user.id,
                        path: targetPath,
                        iv: iv.toString('hex'),
                        encryptedFileKey: encryptedFileKey.encryptedKey.toString('hex'),
                        keyAuthTag: encryptedFileKey.authTag.toString('hex'),
                        keyIv: encryptedFileKey.iv.toString('hex'),
                        isPublic: false,
                        fileGroupId: file.versionGroupId,
                        version: file.metadata_version
                    }
                });

                // ⭐ STREAM ENCRYPTION INSTEAD OF BUFFER ENCRYPTION
                const readable = Readable.from(file.buffer);

                readable
                    .pipe(cipher)
                    .pipe(uploadStream);

                uploadStream.on('finish', () => {

                    // append auth tag at end of file (same as before)
                    const authTag = cipher.getAuthTag();

                    // update metadata with authTag if you store file authTag separately
                    resolve({ filename: file.originalname });
                });

                uploadStream.on('error', reject);
            });
        });

        const results = await Promise.all(uploadPromises);
        
        try {
            const activities = results.map(r => ({
                userId: req.user.id,
                action: 'uploaded',
                filename: r.filename
            }));
            await activityModel.insertMany(activities);
        } catch(activityErr) {
            console.error("Failed to log activity details:", activityErr);
        }
        
        res.status(201).json({ files: results });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error uploading files');
    }
}


export async function getFiles(req, res) {
    try {
        if (!req.session?.userMasterKey) {
            return res.status(401).json({ error: "User master key missing" });
        }

        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection; // need this bcz we are using bucket(it doesn't have updateMany)
        const files = await filesCollection.find({
            "metadata.userId": req.user.id,
            "metadata.path": req.query.path,
            "metadata.isPublic": true,
            "metadata.publicExpiresAt": { $ne: null, $lt: new Date() }
        }).toArray();
        const SERVER_MASTER_KEY = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
        for (const file of files) {
            const fileKey = decryptKey(
                Buffer.from(file.metadata.encryptedFileKey, 'hex'),
                SERVER_MASTER_KEY,
                Buffer.from(file.metadata.keyIv, 'hex'),
                Buffer.from(file.metadata.keyAuthTag, 'hex')
            );
            const encryptedFileKey = encryptKey(fileKey, Buffer.from(req.session.userMasterKey, 'hex'));
            await filesCollection.updateOne(
                { _id: file._id },
                {
                    $set: {
                        "metadata.isPublic": false,
                        "metadata.publicExpiresAt": null,
                        "metadata.publicUrl": null,
                        "metadata.encryptedFileKey": encryptedFileKey.encryptedKey.toString('hex'),
                        "metadata.keyIv": encryptedFileKey.iv.toString('hex'),
                        "metadata.keyAuthTag": encryptedFileKey.authTag.toString('hex')
                    }
                }
            );
        }


        // ✅ Step 2: fetch files normally
        let query = { "metadata.userId": req.user.id };
        let files2Cursor;

        if (req.query.path === '/recent') {
            query["metadata.path"] = { $ne: "/trash" };
            files2Cursor = filesCollection.find(query).sort({ uploadDate: -1 }).limit(10);
        } else if (req.query.path === '/starred') {
            query["metadata.path"] = { $ne: "/trash" };
            query["metadata.isStarred"] = true;
            files2Cursor = filesCollection.find(query);
        } else {
            query["metadata.path"] = req.query.path || "";
            files2Cursor = filesCollection.find(query);
        }

        const files2 = await files2Cursor.toArray();

        // Group by fileGroupId or filename if fileGroupId missing
        const grouped = {};
        files2.forEach(file => {
            const groupId = file.metadata.fileGroupId || file._id.toString();
            if (!grouped[groupId]) {
                grouped[groupId] = {
                    ...file,
                    versions: []
                };
            }
            grouped[groupId].versions.push(file);
        });

        const result = Object.values(grouped).map(group => {
            group.versions.sort((a, b) => (b.metadata.version || 1) - (a.metadata.version || 1));
            const latest = group.versions[0];
            return {
                ...latest,
                versions: group.versions
            };
        });

        return res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Error retrieving files" });
    }
}



export async function deleteFile(req, res) {
    try {
        const bucket = await ensureBucket();
        const fileId = new ObjectId(req.params.fileId);
        const deleteMode = req.query.deleteMode || req.body.deleteMode || 'all'; // 'all' or 'revert'
        const permanent = req.query.permanent === 'true'; // soft or hard delete

        if (!fileId) {
            return res.status(404).json({ error: "File not found" });
        }

        const filesCollection = bucket.s._filesCollection;
        const fileForLog = await filesCollection.findOne({ _id: fileId });
        const filename = fileForLog ? fileForLog.filename : "Unknown File";

        if (deleteMode === 'all') {
            const file = await filesCollection.findOne({ _id: fileId });
            if (file && file.metadata && file.metadata.fileGroupId) {
                const allVersions = await filesCollection.find({ "metadata.fileGroupId": file.metadata.fileGroupId }).toArray();
                for (const v of allVersions) {
                    if (permanent) {
                        try { await bucket.delete(v._id); } catch(e) {}
                    } else {
                        await filesCollection.updateOne({ _id: v._id }, { $set: { "metadata.path": "/trash" } });
                    }
                }
            } else {
                if (permanent) {
                    await bucket.delete(fileId);
                } else {
                    await filesCollection.updateOne({ _id: fileId }, { $set: { "metadata.path": "/trash" } });
                }
            }
        } else if (deleteMode === 'revert') {
            // Revert deletes current version or moves it to trash
            if (permanent) {
                await bucket.delete(fileId);
            } else {
                await filesCollection.updateOne({ _id: fileId }, { $set: { "metadata.path": "/trash" } });
            }
        }

        res.status(200).json({ message: permanent ? "File deleted permanently" : "File moved to trash" });
        
        try {
            await activityModel.create({
                userId: req.user.id,
                action: permanent ? 'permanently deleted' : 'moved to trash',
                filename: filename
            });
        } catch(activityErr) {
            console.error("Error logging delete activity", activityErr);
        }
    }
    catch (err) {
        res.status(500).json({ error: "Error deleting file" });
    }
}

export async function restoreFile(req, res) {
    try {
        const bucket = await ensureBucket();
        const fileId = new ObjectId(req.params.fileId);
        const filesCollection = bucket.s._filesCollection;

        const file = await filesCollection.findOne({ _id: fileId });
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        if (file.metadata && file.metadata.fileGroupId) {
            await filesCollection.updateMany(
                { "metadata.fileGroupId": file.metadata.fileGroupId },
                { $set: { "metadata.path": "" } }
            );
        } else {
            await filesCollection.updateOne(
                { _id: fileId },
                { $set: { "metadata.path": "" } }
            );
        }

        res.status(200).json({ message: "File restored successfully" });
    } catch (err) {
        console.error("Error restoring file", err);
        res.status(500).json({ error: "Error restoring file" });
    }
}

export async function toggleStarFile(req, res) {
    try {
        const bucket = await ensureBucket();
        const fileId = new ObjectId(req.params.fileId);
        const { isStarred } = req.body;
        const filesCollection = bucket.s._filesCollection;

        const file = await filesCollection.findOne({ _id: fileId });
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        if (file.metadata && file.metadata.fileGroupId) {
            await filesCollection.updateMany(
                { "metadata.fileGroupId": file.metadata.fileGroupId },
                { $set: { "metadata.isStarred": isStarred } }
            );
        } else {
            await filesCollection.updateOne(
                { _id: fileId },
                { $set: { "metadata.isStarred": isStarred } }
            );
        }

        res.status(200).json({ message: "Star status updated successfully", isStarred });
    } catch (err) {
        console.error("Error toggling star", err);
        res.status(500).json({ error: "Error updating star status" });
    }
}

export async function getStorageStats(req, res) {
    try {
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        
        const aggregation = await filesCollection.aggregate([
            { 
               $match: { 
                    $or: [
                        { "metadata.userId": req.user.id },
                        { "metadata.userId": new ObjectId(req.user.id) }
                    ]
               } 
            },
            { $group: { _id: null, totalBytes: { $sum: "$length" }, count: { $sum: 1 } } }
        ]).toArray();

        const stats = aggregation.length > 0 ? aggregation[0] : { totalBytes: 0, count: 0 };
        const MAX_STORAGE_BYTES = 15 * 1024 * 1024 * 1024; // 15 GB free tier
        
        res.status(200).json({ 
            usedBytes: stats.totalBytes, 
            totalFiles: stats.count,
            maxBytes: MAX_STORAGE_BYTES
        });
    } catch (error) {
        console.error("Storage stats error", error);
        res.status(500).json({ error: "Failed to get storage stats" });
    }
}

export async function createFolder(req, res) {
    const { path, folderName } = req.body;

    const folderDoc = new foldermodel({
        filename: folderName,
        uploadDate: new Date(),
        contentType: 'folder',
        metadata: {
            userId: req.user.id,
            path,
        }
    });

    const result = await folderDoc.save();
    // console.log(result);
    res.status(201).json({
        _id: result.insertedId,
        ...folderDoc
    });
}
export async function getFolders(req, res) {
    try {
        // console.log(req.query.path);
        const folders = await foldermodel.find({ "metadata.userId": req.user.id, "metadata.path": req.query.path })
        if (!folders || folders.length === 0) {
            return res.status(200).json([]);
        }
        return res.status(200).json(folders);
    }
    catch (err) {
        return res.status(500).json({ error: "Error retrieving folders" });
    }
}
export async function deleteFolder(req, res) {
    try {
        const folderId = req.params.folderId;
        const result = await foldermodel.findByIdAndDelete(folderId, { "metadata.userId": req.user.id });
        if (result.ok) {
            res.status(200).json({ message: "Folder deleted successfully", result });
        }
        res.status(200).json({ message: "Folder not found" });
    }
    catch (err) {
        res.status(500).json({ error: "Error deleting folder" });
    }
}
export function decryptKey(encryptedFileKey, userMasterKey, keyIv, keyAuthTag) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', userMasterKey, keyIv);
        decipher.setAuthTag(keyAuthTag);
        const fileKey = Buffer.concat([
            decipher.update(encryptedFileKey),
            decipher.final()
        ])
        return fileKey;
    }
    catch (err) {
        console.log("Error decrypting file key", err);
        return null;
    }
}
export async function downloadFile(req, res) {
    try {
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const fileId = new ObjectId(req.params.fileId);
        // console.log(fileId+" in uploadFIles downloadig file");
        const file = await filesCollection.findOne({ _id: fileId, "metadata.userId": req.user.id })//checking if metadatat is present
        if (!file) {
            return res.status(404).json({ error: 'File not found' });//if metadata is not present then file is not found
        }

        // const file = files[0];

        let DECRYPTION_KEY;
        if (file.metadata.isPublic) {
            if (!process.env.SERVER_MASTER_KEY) {
                return res.status(500).json({ error: 'Server master key not found' });
            }
            DECRYPTION_KEY = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
        } else {
            if (!req.session || !req.session.userMasterKey) {
                return res.status(401).json({ error: 'Session expired. Please login again to view files.' });
            }
            DECRYPTION_KEY = Buffer.from(req.session.userMasterKey, 'hex');
        }

        res.set('Content-Type', file.contentType);
        res.set('Content-Disposition', `inline; filename="${file.filename}"`);
        // res.set('Cache-Control', 'private, max-age=86400'); // 1 day
        // const salt = Buffer.from(file.metadata.salt, 'hex');
        const iv = Buffer.from(file.metadata.iv, 'hex');
        // const key = deriveFileKey(req.user.id, salt);
        const fileKey = decryptKey(
            Buffer.from(file.metadata.encryptedFileKey, "hex"),
            DECRYPTION_KEY,
            Buffer.from(file.metadata.keyIv, "hex"),
            Buffer.from(file.metadata.keyAuthTag, "hex")
        )
        const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, iv);
        const downloadStream = bucket.openDownloadStream(fileId);
        // let tail = Buffer.alloc(0);
        let lastChunk = null;

        downloadStream.on('data', chunk => {

            if (lastChunk) {
                const decrypted = decipher.update(lastChunk);
                res.write(decrypted);
            }

            lastChunk = chunk;
        });

        downloadStream.on('end', () => {
            try {
                const data = lastChunk.slice(0, lastChunk.length - 16);
                const authTag = lastChunk.slice(lastChunk.length - 16);

                res.write(decipher.update(data));
                decipher.setAuthTag(authTag);

                const final = decipher.final();
                if (final.length) res.write(final);

                res.end();
            } catch (err) {
                res.status(401).end();
            }
        });

        downloadStream.on('error', (err) => {
            console.error("Stream Error:", err);
            res.status(500).end();
        })
    }
    catch (err) {
        console.error("Error downloading file:", err);
        res.status(500).end();
    }
}
export async function previewFile(req, res) {
    try {
        const fileId = new ObjectId(req.params.fileId);
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        // ⭐ Fetch only required metadata (faster)
        const file = await filesCollection.findOne(
            { _id: fileId },
            {
                projection: {
                    contentType: 1,
                    metadata: 1,
                    filename: 1
                }
            }
        );
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        let DECRYPTION_KEY;
        if (file.metadata.isPublic) {
            DECRYPTION_KEY = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
        } else {
            if (!req.session?.userMasterKey) {
                return res.status(401).json({ error: 'Session expired' });
            }
            DECRYPTION_KEY = Buffer.from(req.session.userMasterKey, 'hex');
        }
        // ⭐ Important headers for fast preview
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.flushHeaders();
        const iv = Buffer.from(file.metadata.iv, 'hex');
        const fileKey = decryptKey(
            Buffer.from(file.metadata.encryptedFileKey, 'hex'),
            DECRYPTION_KEY,
            Buffer.from(file.metadata.keyIv, 'hex'),
            Buffer.from(file.metadata.keyAuthTag, 'hex')
        );
        const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, iv);
        const readStream = bucket.openDownloadStream(fileId);
        let lastChunk = null;
        readStream.on('data', chunk => {
            if (lastChunk) {
                // ⭐ immediately send decrypted chunk
                res.write(decipher.update(lastChunk));
            }
            lastChunk = chunk;
        });
        readStream.on('end', () => {
            try {
                if (!lastChunk) return res.end();
                const data = lastChunk.slice(0, lastChunk.length - 16);
                const authTag = lastChunk.slice(lastChunk.length - 16);
                if (data.length) {
                    res.write(decipher.update(data));
                }
                decipher.setAuthTag(authTag);
                const final = decipher.final();
                if (final.length) res.write(final);
                res.end();
            } catch (err) {
                console.log("Auth failed", err);
                res.status(401).end();
            }
        });
        readStream.on('error', err => {
            console.error("Stream Error:", err);
            res.status(500).end();
        });
    } catch (err) {
        console.error("Error previewing file:", err);
        res.status(500).end();
    }
}


export async function makePublic(req, res) {
    try {
        const db = mongoose.connection.db;
        // console.log('went into makepublic')
        // console.log(req.user.id)
        const fileId = new ObjectId(req.params.fileId);
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const file = await filesCollection.findOne({ _id: fileId, "metadata.userId": req.user.id });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        if (!req.session.userMasterKey) {
            return res.status(401).json({ error: 'Session expired. Please login again to make file public.' });
        }
        const USER_MASTER_KEY = Buffer.from(req.session.userMasterKey, 'hex');
        // console.log(USER_MASTER_KEY)
        // console.log(file)
        const iv = Buffer.from(file.metadata.iv, 'hex');
        const fileKey = decryptKey(
            Buffer.from(file.metadata.encryptedFileKey, 'hex'),
            USER_MASTER_KEY,
            Buffer.from(file.metadata.keyIv, 'hex'),
            Buffer.from(file.metadata.keyAuthTag, 'hex')
        )
        let expiresAt = null;
        if (req.body.duration !== 'permanent') {
            const time = req.body.duration.split('-');
            const days = parseInt(time[0]) || 0;
            const hrs = parseInt(time[1]) || 0;
            const mins = parseInt(time[2]) || 0;
            const duration = days * 24 * 60 * 60 + hrs * 60 * 60 + mins * 60;
            expiresAt = new Date(Date.now() + duration * 1000);
        }

        if (!process.env.SERVER_MASTER_KEY) {
            return res.status(500).json({ error: 'Server master key not found' });
        }
        const encryptedFile = encryptKey(fileKey, Buffer.from(process.env.SERVER_MASTER_KEY, 'hex'))
        const publicFileId = crypto.randomBytes(16).toString('hex');
        const updatedFile = await filesCollection.updateOne({
            _id: fileId,
            "metadata.userId": req.user.id
        }, {
            $set: {
                "metadata.isPublic": true,
                "metadata.encryptedFileKey": encryptedFile.encryptedKey.toString('hex'),
                "metadata.keyIv": encryptedFile.iv.toString('hex'),
                "metadata.keyAuthTag": encryptedFile.authTag.toString('hex'),
                "metadata.filePublicId": publicFileId,
                "metadata.publicExpiresAt": expiresAt,
                "metadata.accessCount": 0
            }
        });
        if (!updatedFile.modifiedCount) {
            return res.status(400).json({ error: 'Failed to make file public' });
        }
        res.status(200).json({ message: 'File made public successfully', publicFileId: publicFileId });
    }
    catch (err) {
        console.error("Error making file public:", err);
        res.status(500).json({ error: "Error making file public: " + err.message })
    }
}
export async function publicFile(req, res) {
    try {
        // console.log("came into public file" + req.params.filePublicId)
        const filePublicId = req.params.filePublicId;
        const db = mongoose.connection.db;
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const file = await filesCollection.findOne({ "metadata.filePublicId": filePublicId, "metadata.isPublic": true });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.flushHeaders();
        if (file.metadata.publicExpiresAt && file.metadata.publicExpiresAt < Date.now()) {
            const SERVER_MASTER_KEY = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
            const fileKey = decryptKey(
                Buffer.from(file.metadata.encryptedFileKey, 'hex'),
                SERVER_MASTER_KEY,
                Buffer.from(file.metadata.keyIv, 'hex'),
                Buffer.from(file.metadata.keyAuthTag, 'hex')
            )
            const encryptedFile = encryptKey(fileKey, Buffer.from(req.session.userMasterKey, 'hex'));

            await db.collection('uploads.files').updateOne({
                _id: file._id,
                "metadata.userId": file.metadata.userId
            }, {
                $set: {
                    "metadata.isPublic": false,
                    "metadata.filePublicId": null,
                    "metadata.publicExpiresAt": null,
                    "metadata.encryptedFileKey": encryptedFile.encryptedKey.toString('hex'),
                    "metadata.keyIv": encryptedFile.iv.toString('hex'),
                    "metadata.keyAuthTag": encryptedFile.authTag.toString('hex')
                }
            });
            return res.status(404).json({ error: 'File not found' });
        }

        // Increment access count
        await filesCollection.updateOne({ _id: file._id }, { $inc: { "metadata.accessCount": 1 } });

        const iv = Buffer.from(file.metadata.iv, 'hex');
        const fileKey = decryptKey(
            Buffer.from(file.metadata.encryptedFileKey, 'hex'),
            Buffer.from(process.env.SERVER_MASTER_KEY, 'hex'),
            Buffer.from(file.metadata.keyIv, 'hex'),
            Buffer.from(file.metadata.keyAuthTag, 'hex')
        )
        const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, iv);
        const readStream = bucket.openDownloadStream(file._id);
        // let tail = Buffer.alloc(0);
                let lastChunk = null;

        readStream.on('data', chunk => {

            if (lastChunk) {
                const decrypted = decipher.update(lastChunk);
                res.write(decrypted);
            }

            lastChunk = chunk;
        });

        readStream.on('end', () => {
            try {
                const data = lastChunk.slice(0, lastChunk.length - 16);
                const authTag = lastChunk.slice(lastChunk.length - 16);

                res.write(decipher.update(data));
                decipher.setAuthTag(authTag);

                const final = decipher.final();
                if (final.length) res.write(final);

                res.end();
            } catch (err) {
                res.status(401).end();
            }
        });

        readStream.on('error', (err) => {
            console.error("Stream Error:", err);
            res.status(500).end();
        })
    }
    catch (err) {
        console.error("Error showing public file:", err);
        res.status(500).json({ error: "Error showing public file: " + err.message })
    }
}

export async function makePrivate(req, res) {
    try {
        // console.log("came into make private" + req.params.fileId)
        const fileId = new ObjectId(req.params.fileId);
        const db = mongoose.connection.db;
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const file = await filesCollection.findOne({ _id: fileId, "metadata.userId": req.user.id });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        const fileKey = decryptKey(
            Buffer.from(file.metadata.encryptedFileKey, 'hex'),
            Buffer.from(process.env.SERVER_MASTER_KEY, 'hex'),
            Buffer.from(file.metadata.keyIv, 'hex'),
            Buffer.from(file.metadata.keyAuthTag, 'hex')
        )
        const encryptedFileKey = encryptKey(fileKey, Buffer.from(req.session.userMasterKey, 'hex'))
        const updatedFile = await filesCollection.updateOne({
            _id: file._id,
            "metadata.userId": req.user.id
        }, {
            $set: {
                "metadata.isPublic": false,
                "metadata.encryptedFileKey": encryptedFileKey.encryptedKey.toString('hex'),
                "metadata.keyIv": encryptedFileKey.iv.toString('hex'),
                "metadata.keyAuthTag": encryptedFileKey.authTag.toString('hex'),
                "metadata.filePublicId": null,
                "metadata.publicExpiresAt": null
            }
        });
        if (!updatedFile.modifiedCount) {
            return res.status(400).json({ error: 'Failed to make file private' });
        }
        res.status(200).json({ message: 'File made private successfully' });
    }
    catch (err) {
        console.error("Error making file private:", err);
        res.status(500).json({ error: "Error making file private: " + err.message })
    }
}

export async function getPublicFilesList(req, res) {
    try {
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const publicFiles = await filesCollection.find({ 
            "metadata.userId": req.user.id, 
            "metadata.isPublic": true 
        }).project({ filename: 1, metadata: 1, uploadDate: 1 }).toArray();
        res.status(200).json(publicFiles);
    } catch(err) {
         res.status(500).json({ error: "Error fetching public files" });
    }
}

export async function makeAllPrivate(req, res) {
    try {
        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;
        const publicFiles = await filesCollection.find({ "metadata.userId": req.user.id, "metadata.isPublic": true }).toArray();

        for (const file of publicFiles) {
            const fileKey = decryptKey(
                Buffer.from(file.metadata.encryptedFileKey, 'hex'),
                Buffer.from(process.env.SERVER_MASTER_KEY, 'hex'),
                Buffer.from(file.metadata.keyIv, 'hex'),
                Buffer.from(file.metadata.keyAuthTag, 'hex')
            );
            const encryptedFileKey = encryptKey(fileKey, Buffer.from(req.session.userMasterKey, 'hex'));
            await filesCollection.updateOne({ _id: file._id }, {
                $set: {
                    "metadata.isPublic": false,
                    "metadata.encryptedFileKey": encryptedFileKey.encryptedKey.toString('hex'),
                    "metadata.keyIv": encryptedFileKey.iv.toString('hex'),
                    "metadata.keyAuthTag": encryptedFileKey.authTag.toString('hex'),
                    "metadata.filePublicId": null,
                    "metadata.publicExpiresAt": null,
                    "metadata.accessCount": 0
                }
            });
        }
        res.status(200).json({ message: "All files made private successfully" });
    } catch(err) {
        res.status(500).json({ error: "Error making all private" });
    }
}