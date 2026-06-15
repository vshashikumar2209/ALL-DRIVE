import activityModel from '../models/activityModel.js';

export async function getHistory(req, res) {
    try {
        const { timeframe } = req.query;
        let query = { userId: req.user.id };
        const now = new Date();
        
        if (timeframe === 'today') {
            const startOfDay = new Date(now.setHours(0, 0, 0, 0));
            query.timestamp = { $gte: startOfDay };
        }
        
        const activities = await activityModel.find(query)
            .sort({ timestamp: -1 })
            .limit(100);
        res.status(200).json(activities);
    } catch (err) {
        console.error("Error fetching history:", err);
        res.status(500).json({ error: "Failed to fetch history" });
    }
}

export async function deleteHistory(req, res) {
    try {
        const { timeframe } = req.query;
        let query = { userId: req.user.id };
        const now = new Date();
        
        if (timeframe === 'today') {
            const startOfDay = new Date(now.setHours(0, 0, 0, 0));
            query.timestamp = { $gte: startOfDay };
        } else if (timeframe === 'week') {
            const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
            startOfWeek.setHours(0, 0, 0, 0);
            query.timestamp = { $gte: startOfWeek };
        } else if (timeframe === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            query.timestamp = { $gte: startOfMonth };
        } else if (timeframe === 'year') {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            query.timestamp = { $gte: startOfYear };
        } else if (timeframe === 'all') {
            // Default query deletes all for user
        } else {
             return res.status(400).json({ error: "Invalid timeframe setting" });
        }
        
        await activityModel.deleteMany(query);
        res.status(200).json({ message: "History deleted successfully" });
    } catch(err) {
        console.error("Error deleting history:", err);
        res.status(500).json({ error: "Failed to delete history" });
    }
}
