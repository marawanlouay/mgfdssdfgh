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
export default router;
