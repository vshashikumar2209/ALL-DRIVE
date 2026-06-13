import jwt from "jsonwebtoken";

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
}

export async function authMiddleware(req, res, next){
    let token = null;
    const authHeader = req.headers['authorization'];
    if(authHeader && authHeader.startsWith('Bearer ')){
        token = authHeader.split(' ')[1];
    }
    if(!token && req.cookies?.token){
        token = req.cookies.token;
    }
    if(!token){
        return res.status(401).json({success:false, message:"No token provided"});
    }
    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch(err){ 
        return res.status(401).json({success:false, message:"Token expired or Invalid token"});
    }
}