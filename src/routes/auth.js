import {randomBytes,createHash} from 'node:crypto';
import {Router} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {pool} from '../db.js';
import {requireAuth} from '../middleware/auth.js';
const router=Router();
const emailOk=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const setCookie=(res,u)=>{const token=jwt.sign({id:u.id,username:u.username,email:u.email,role:u.role},process.env.JWT_SECRET,{expiresIn:'7d',algorithm:'HS256'});res.cookie('chessnest_token',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*24*60*60*1000});};
router.post('/signup',async(req,res)=>{
 const {email,password,username}=req.body||{};
 if(!emailOk(email)||typeof username!=='string'||username.trim().length<3||username.length>50||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'Valid email, username (3–50 characters), and password (8–128 characters) required.'});
 try{const hash=await bcrypt.hash(password,12);const r=await pool.query('INSERT INTO public.users (email,username,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,email,username,role',[email.trim().toLowerCase(),username.trim(),hash,'player']);
 const u=r.rows[0];setCookie(res,u);res.status(201).json({user:u});}
 catch(e){if(e.code==='23505')return res.status(409).json({error:'Email or username already exists.'});console.error('signup',e.code||e.message);res.status(500).json({error:'Unable to create account.'});}
});
router.post('/login',async(req,res)=>{
 const {email,password}=req.body||{};if(!emailOk(email)||typeof password!=='string')return res.status(400).json({error:'Invalid credentials.'});
 try{const r=await pool.query('SELECT id,email,username,role,password_hash FROM public.users WHERE lower(email)=lower($1) LIMIT 1',[email]);const u=r.rows[0];if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'Invalid credentials.'});setCookie(res,u);res.json({user:{id:u.id,email:u.email,username:u.username,role:u.role}});}catch(e){console.error('login',e.code||e.message);res.status(500).json({error:'Unable to log in.'});}
});
router.post('/logout',(req,res)=>{res.clearCookie('chessnest_token',{sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.json({message:'Logged out.'});});
router.get('/me',requireAuth,(req,res)=>res.json({user:req.user}));
const digest=t=>createHash('sha256').update(t).digest('hex');
router.post('/forgot-password',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase();
 if(!emailOk(email))return res.status(400).json({error:'Enter a valid email.'});
 if(!process.env.RESEND_API_KEY||!process.env.RESET_FROM_EMAIL)return res.status(503).json({error:'Password recovery email service is not configured yet.'});
 const message='If an account exists, a reset link will be sent to its email.';
 try{
 const token=randomBytes(32).toString('hex');
 const q=await pool.query("UPDATE public.users SET reset_token_hash=$2,reset_expires_at=NOW()+INTERVAL '30 minutes',reset_requested_at=NOW() WHERE lower(email)=$1 AND (reset_requested_at IS NULL OR reset_requested_at<NOW()-INTERVAL '2 minutes') RETURNING email",[email,digest(token)]);
 if(q.rowCount){const link='https://chessnest.vercel.app/#reset='+token;const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESET_FROM_EMAIL,to:[q.rows[0].email],subject:'Reset your ChessNest password',text:'Reset your password: '+link+' . This link expires in 30 minutes. Ignore this email if you did not request it.'}),signal:AbortSignal.timeout(10000)});if(!mail.ok){await pool.query('UPDATE public.users SET reset_token_hash=NULL,reset_expires_at=NULL,reset_requested_at=NULL WHERE reset_token_hash=$1',[digest(token)]);console.error('reset email delivery failed',mail.status);}}
 return res.json({message});
 }catch(e){console.error('password recovery',e.code||e.name);return res.status(503).json({error:'Password recovery temporarily unavailable.'});}
});
router.post('/reset-password',async(req,res)=>{
 const {token,password}=req.body||{};
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)return res.status(400).json({error:'Invalid link or password (8 characters minimum, 72 bytes maximum).'});
 try{const hash=await bcrypt.hash(password,12);const q=await pool.query('UPDATE public.users SET password_hash=$2,reset_token_hash=NULL,reset_expires_at=NULL,reset_requested_at=NULL,password_changed_at=NOW() WHERE reset_token_hash=$1 AND reset_expires_at>NOW() RETURNING id',[digest(token),hash]);if(!q.rowCount)return res.status(400).json({error:'Reset link is invalid or expired.'});res.clearCookie('chessnest_token',{sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.json({message:'Password updated. Log in with your new password.'});}catch(e){console.error('password reset',e.code||e.name);res.status(500).json({error:'Unable to reset password.'});}
});
export default router;
