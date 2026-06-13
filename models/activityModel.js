import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    filename: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
}, { collection: "activities" });

const activityModel = mongoose.model("Activity", activitySchema);

export default activityModel;
