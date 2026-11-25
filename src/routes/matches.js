import {Router} from 'express';
import {Chess} from 'chess.js';
import {pool} from '../db.js';
import {requireAuth,requireRole} from '../middleware/auth.js';
const router=Router();
const auth=[requireAuth,requireRole('player','admin')];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(res,s,m)=>res.status(s).json({error:m});
router.get('/',...auth,async(req,res)=>{try{const r=await pool.query('SELECT id,game_type,status,result,current_fen,current_turn,created_at,ended_at,white_player_id,black_player_id FROM public.matches WHERE white_player_id=$1 OR black_player_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id]);res.json({matches:r.rows});}catch(e){console.error(e);fail(res,500,'Unable to list matches.');}});
router.post('/',...auth,async(req,res)=>{const type=req.body?.game_type||'system';if(!['system','online'].includes(type))return fail(res,400,'Invalid game type.');try{const r=await pool.query('INSERT INTO public.matches (white_player_id,game_type,status) VALUES ($1,$2,$3) RETURNING *',[req.user.id,type,type==='system'?'active':'waiting']);res.status(201).json({match:r.rows[0]});}catch(e){console.error(e);fail(res,500,'Unable to create match.');}});
router.get('/:id',...auth,async(req,res)=>{if(!UUID.test(req.params.id))return fail(res,400,'Invalid match ID.');try{const r=await pool.query('SELECT * FROM public.matches WHERE id=$1 AND (white_player_id=$2 OR black_player_id=$2)',[req.params.id,req.user.id]);if(!r.rows.length)return fail(res,404,'Match not found.');const m=await pool.query('SELECT move_number,move_notation,board_state,created_at FROM public.moves WHERE match_id=$1 ORDER BY move_number',[req.params.id]);res.json({match:r.rows[0],moves:m.rows});}catch(e){console.error(e);fail(res,500,'Unable to retrieve match.');}});
router.post('/:id/join',...auth,async(req,res)=>{if(!UUID.test(req.params.id))return fail(res,400,'Invalid match ID.');try{const r=await pool.query("UPDATE public.matches SET black_player_id=$2,status='active' WHERE id=$1 AND game_type='online' AND status='waiting' AND black_player_id IS NULL AND white_player_id<>$2 RETURNING *",[req.params.id,req.user.id]);if(!r.rows.length)return fail(res,409,'Match cannot be joined.');res.json({match:r.rows[0]});}catch(e){console.error(e);fail(res,500,'Unable to join match.');}});
router.post('/:id/moves',...auth,async(req,res)=>{
 if(!UUID.test(req.params.id))return fail(res,400,'Invalid match ID.');const notation=req.body?.move;
 if(typeof notation!=='string'||notation.length>20)return fail(res,400,'Provide move in SAN or UCI notation.');
 const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM public.matches WHERE id=$1 AND (white_player_id=$2 OR black_player_id=$2) FOR UPDATE',[req.params.id,req.user.id]);const match=r.rows[0];if(!match){await client.query('ROLLBACK');return fail(res,404,'Match not found.');}if(match.status!=='active'){await client.query('ROLLBACK');return fail(res,409,'Match is not active.');}
 const color=match.white_player_id===req.user.id?'w':'b';const board=new Chess(match.current_fen);if(board.turn()!==color){await client.query('ROLLBACK');return fail(res,409,'Not your turn.');}
 let move;try{move=/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(notation)?board.move({from:notation.slice(0,2),to:notation.slice(2,4),...(notation[4]?{promotion:notation[4]}:{})}):board.move(notation);}catch{await client.query('ROLLBACK');return fail(res,400,'Illegal move.');}
 if(!move){await client.query('ROLLBACK');return fail(res,400,'Illegal move.');}
 const count=await client.query('SELECT COALESCE(MAX(move_number),0)+1 AS next FROM public.moves WHERE match_id=$1',[match.id]);await client.query('INSERT INTO public.moves (match_id,player_id,move_number,move_notation,board_state) VALUES ($1,$2,$3,$4,$5)',[match.id,req.user.id,count.rows[0].next,move.san,board.fen()]);
 const status=board.isGameOver()?'completed':'active';const result=board.isCheckmate()?(color==='w'?'white':'black'):board.isGameOver()?'draw':null;
 await client.query('UPDATE public.matches SET current_fen=$2,current_turn=$3,status=$4,result=$5,ended_at=CASE WHEN $4=\'completed\' THEN NOW() ELSE NULL END WHERE id=$1',[match.id,board.fen(),board.turn()==='w'?'white':'black',status,result]);await client.query('COMMIT');res.json({move:move.san,fen:board.fen(),status,result});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error(e);fail(res,500,'Unable to save move.');}finally{client.release();}
});
export default router;
