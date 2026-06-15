import userModel from "../models/userModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { deriveUserMasterKey, encryptKey, decryptKey, ensureBucket } from "./uploadFiles.js";
import crypto from 'crypto';

export async function login(req, res) {
    // const user = await userModel.findOne({ email });
    
    console.log("LOGIN ROUTE HIT");
    console.log("Request Body:", req.body);
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    try {
        const user = await userModel.findOne({ email });
        console.log("Found user:", user);
        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log("Login failed: Invalid credentials");
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        if (!user.salt) {
            console.error(`Login critical error: User record ${user._id} missing salt`);
            return res.status(500).json({ success: false, message: "Account corrupted (missing salt). Please register a new account." });
        }

        //createin a jwt token
        const userMasterKey = await deriveUserMasterKey(password, user.salt);
        req.session.userMasterKey = userMasterKey.toString('hex');

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: { name: user.name, email: user.email }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Login failed: " + error.message });
    }
}

export async function register(req, res) {
    
    try {
        const { username, email, password } = req.body;
        console.log("Register request body:", req.body);

        if (!username || !email || !password) {
            console.log("Missing fields - username:", username, "email:", email, "password:", password);
            return res.status(400).json({ success: false, message: "Username, email and password are required" });
        }

        const existingUser = await userModel.findOne({ email: email });
        if (existingUser) {
            console.log("User already exists with email:", email);
            return res.status(400).json({ success: false, message: "Email already registered" });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const newUser = new userModel({ name: username, email, password: password, salt });
        await newUser.save();
        // console.log("User registered successfully:", email);
        res.status(201).json({ success: true, message: "User registered successfully" });
    } catch (error) {
        // console.error("Register error:", error);
        res.status(500).json({ success: false, message: "Registration failed: " + error.message });
    }
}

export async function changePassword(req, res) {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: "Old and new passwords are required" });
    }

    try {
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Incorrect old password" });
        }

        // Derive keys
        const oldMasterKey = await deriveUserMasterKey(oldPassword, user.salt);
        const newMasterKey = await deriveUserMasterKey(newPassword, user.salt);

        const bucket = await ensureBucket();
        const filesCollection = bucket.s._filesCollection;

        // Fetch all files for this user
        const files = await filesCollection.find({ "metadata.userId": user._id.toString() }).toArray();

        // Migration: Re-encrypt file keys
        for (const file of files) {
            // Only re-encrypt if not public (public files use SERVER_MASTER_KEY)
            if (!file.metadata.isPublic && file.metadata.encryptedFileKey) {
                try {
                    const fileKey = decryptKey(
                        Buffer.from(file.metadata.encryptedFileKey, 'hex'),
                        oldMasterKey,
                        Buffer.from(file.metadata.keyIv, 'hex'),
                        Buffer.from(file.metadata.keyAuthTag, 'hex')
                    );

                    const reEncrypted = encryptKey(fileKey, newMasterKey);

                    await filesCollection.updateOne(
                        { _id: file._id },
                        {
                            $set: {
                                "metadata.encryptedFileKey": reEncrypted.encryptedKey.toString('hex'),
                                "metadata.keyIv": reEncrypted.iv.toString('hex'),
                                "metadata.keyAuthTag": reEncrypted.authTag.toString('hex')
                            }
                        }
                    );
                } catch (err) {
                    console.error(`Failed to migrate file ${file._id}:`, err);
                    // Decide if you want to abort or continue. Continuing seems safer for the rest of data.
                }
            }
        }

        // Update user password - user.password = newPassword will be hashed by pre-save hook
        user.password = newPassword;
        await user.save();

        // Update session key
        req.session.userMasterKey = newMasterKey.toString('hex');

        res.status(200).json({ success: true, message: "Password updated and files re-encrypted successfully" });
    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ success: false, message: "Failed to change password: " + error.message });
    }
}
