import jwt from 'jsonwebtoken';
export function requireAuth(req,res,next){
 const token=req.cookies?.chessnest_token;
 if(!token || !process.env.JWT_SECRET)return res.status(401).json({error:'Authentication required.'});
 try{const user=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});if(!user?.id)return res.status(401).json({error:'Invalid token.'});req.user=user;next();}
 catch{return res.status(401).json({error:'Invalid or expired session.'});}
}
export function requireRole(...roles){return(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Insufficient permissions.'});}
