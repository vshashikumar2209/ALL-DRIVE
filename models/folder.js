import mongoose from 'mongoose';

const folderSchema = new mongoose.Schema({
    filename: String,
    uploadDate: Date,
    contentType: String,
    metadata: {
        userId: String,
        path:String
    }
});
const foldermodel = mongoose.model('Folder', folderSchema);
export default foldermodel;