import { Router } from 'express';
import { Chess } from 'chess.js';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Install as app.use('/api', extraRoutes) in api/index.js.
// Adjust imports to ../src/db.js and ../src/middleware/auth.js if this file is in src/.
const router = Router();
const auth = [requireAuth, requireRole('player', 'admin')];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (res, error, status = 400) => res.status(status).json({ error });
const round = x => Math.round(x * 100) / 100;
const average = a => a.length ? round(a.reduce((s, n) => s + n, 0) / a.length) : null;
const input = m => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
const uci = m => m.from + m.to + (m.promotion || '');
const simulate = (board, move) => { const copy = new Chess(board.fen()); copy.move(input(move)); return copy; };
const mateInOne = b => !b.isGameOver() && b.moves({ verbose: true }).some(m => simulate(b, m).isCheckmate());

// These routes intentionally use only known schema columns.
router.get('/lessons', ...auth, async (req, res) => {
  try { const r = await pool.query('SELECT id,title,description,content,lesson_order FROM public.lessons ORDER BY lesson_order,id'); res.json({ lessons: r.rows }); }
  catch (e) { console.error(e); bad(res, 'Unable to retrieve lessons.', 500); }
});
router.get('/lessons/:id/exercises', ...auth, async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid lesson ID.');
  try {
    const r = await pool.query('SELECT id,lesson_id,question,board_position FROM public.exercises WHERE lesson_id=$1 ORDER BY created_at,id', [req.params.id]);
    res.json({ exercises: r.rows }); // Do not leak correct_move.
  } catch (e) { console.error(e); bad(res, 'Unable to retrieve exercises.', 500); }
});
router.post('/exercises/:id/check', ...auth, async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid exercise ID.');
  if (typeof req.body?.move !== 'string' || req.body.move.length > 20) return bad(res, 'Provide a move (SAN or UCI).');
  try {
    const r = await pool.query('SELECT board_position,correct_move FROM public.exercises WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return bad(res, 'Exercise not found.', 404);
    const row = r.rows[0]; const board = new Chess(row.board_position);
    const moves = board.moves({ verbose: true });
    const normalize = text => moves.find(m => m.san === text || uci(m) === text.toLowerCase());
    const submitted = normalize(req.body.move.trim());
    if (!submitted) return bad(res, 'Illegal move for this exercise position.');
    const expected = normalize(row.correct_move);
    if (!expected) return bad(res, 'Exercise answer is invalid.', 409);
    res.json({ correct: uci(submitted) === uci(expected), played_move: submitted.san });
  } catch (e) { console.error(e); bad(res, 'Unable to check exercise.', 500); }
});
router.get('/me/learning-progress', ...auth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT l.id AS lesson_id,l.title,l.lesson_order,COALESCE(bool_or(p.is_completed),false) AS is_completed,MAX(p.completed_at) AS completed_at
      FROM public.lessons l LEFT JOIN public.user_progress p ON p.lesson_id=l.id AND p.user_id=$1
      GROUP BY l.id,l.title,l.lesson_order ORDER BY l.lesson_order,l.id`, [req.user.id]);
    const completed = r.rows.filter(x => x.is_completed).length;
    res.json({ completed_lessons: completed, total_lessons: r.rows.length, completion_percent: r.rows.length ? round(100 * completed / r.rows.length) : 0, lessons: r.rows });
  } catch (e) { console.error(e); bad(res, 'Unable to retrieve progress.', 500); }
});
router.post('/lessons/:id/complete', ...auth, async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid lesson ID.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lesson = await client.query('SELECT id FROM public.lessons WHERE id=$1', [req.params.id]);
    if (!lesson.rows.length) { await client.query('ROLLBACK'); return bad(res, 'Lesson not found.', 404); }
    const existing = await client.query('SELECT id FROM public.user_progress WHERE user_id=$1 AND lesson_id=$2 FOR UPDATE', [req.user.id, req.params.id]);
    if (existing.rows.length) {
      await client.query('UPDATE public.user_progress SET is_completed=true,completed_at=COALESCE(completed_at,NOW()) WHERE user_id=$1 AND lesson_id=$2', [req.user.id, req.params.id]);
    } else {
      await client.query('INSERT INTO public.user_progress (user_id,lesson_id,is_completed,completed_at) VALUES ($1,$2,true,NOW())', [req.user.id, req.params.id]);
    }
    await client.query('COMMIT'); res.json({ lesson_id: req.params.id, is_completed: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); bad(res, 'Unable to complete lesson.', 500); }
  finally { client.release(); }
});

// Consolidated, read-only match analysis: replaces the need for unlimited progress-summary routes.
router.get('/matches/:id/coaching-complete', ...auth, async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid match ID.');
  try {
    const mr = await pool.query(`SELECT id,game_type,status,result,current_fen,current_turn,white_player_id,black_player_id
      FROM public.matches WHERE id=$1 AND (white_player_id=$2 OR black_player_id=$2) LIMIT 1`, [req.params.id, req.user.id]);
    if (!mr.rows.length) return bad(res, 'Match not found.', 404);
    const match = mr.rows[0]; let current;
    try { current = new Chess(match.current_fen); } catch { return bad(res, 'Invalid current FEN.', 409); }
    if ((current.turn() === 'w' ? 'white' : 'black') !== match.current_turn) return bad(res, 'Current turn mismatch.', 409);
    const rr = await pool.query('SELECT move_number,move_notation,board_state FROM public.moves WHERE match_id=$1 ORDER BY move_number', [match.id]);
    const board = new Chess(); const observations = { white: [], black: [] };
    for (let i = 0; i < rr.rows.length; i++) {
      const saved = rr.rows[i];
      if (Number(saved.move_number) !== i + 1) return bad(res, 'Invalid move sequence.', 409);
      let target;
      try { target = new Chess(saved.board_state); } catch { return bad(res, 'Invalid saved board.', 409); }
      const legal = board.isGameOver() ? [] : board.moves({ verbose: true });
      const matches = legal.filter(m => simulate(board, m).fen() === target.fen());
      if (matches.length !== 1) return bad(res, 'Illegal saved move.', 409);
      const played = matches[0];
      if (saved.move_notation !== played.san && saved.move_notation !== uci(played)) return bad(res, 'Saved notation mismatch.', 409);
      const color = board.turn() === 'w' ? 'white' : 'black';
      const after = simulate(board, played);
      const immediateMates = legal.filter(m => simulate(board, m).isCheckmate());
      const missedMate = immediateMates.length > 0 && !after.isCheckmate();
      const exposedMate = mateInOne(after);
      const avoidableMate = exposedMate && legal.some(m => !mateInOne(simulate(board, m)));
      const defendedMate = !exposedMate && legal.some(m => mateInOne(simulate(board, m)));
      const values = { p:1,n:3,b:3,r:5,q:9,k:0 };
      const evalBoard = b => {
        if (b.isCheckmate()) return b.turn() === 'w' ? -1000 : 1000;
        if (b.isDraw()) return 0;
        return b.board().flat().reduce((s,p) => s + (p ? values[p.type] * (p.color === 'w' ? 1 : -1) : 0), 0);
      };
      const perspective = color === 'white' ? 1 : -1;
      const score = m => {
        const next = simulate(board, m);
        if (next.isGameOver()) return evalBoard(next) * perspective;
        return Math.min(...next.moves({verbose:true}).map(reply => evalBoard(simulate(next,reply)) * perspective));
      };
      const candidates = legal.map(m => ({ move:m, score:score(m) })).sort((a,b) => b.score-a.score || uci(a.move).localeCompare(uci(b.move)));
      const best = candidates[0]; const playedScore = candidates.find(x => uci(x.move) === uci(played)).score;
      const loss = round(Math.max(0, best.score - playedScore));
      const accuracy = round((missedMate || avoidableMate) ? Math.min(40,100*Math.exp(-loss/2)) : 100*Math.exp(-loss/2));
      const quality = missedMate || avoidableMate || loss > 3 ? 'blunder' : loss > 1.5 ? 'mistake' : loss > .75 ? 'inaccuracy' : loss > .25 ? 'good' : 'excellent';
      observations[color].push({ move_number:i+1,accuracy,loss,quality,delivered_mate:after.isCheckmate(),missed_mate:missedMate,avoidable_mate:avoidableMate,successful_defense:defendedMate,matched_candidate:uci(best.move)===uci(played),fen:board.fen(),played:played.san,suggested:best.move.san });
      board.move(input(played));
    }
    if (board.fen() !== current.fen()) return bad(res, 'Saved history does not match current board.', 409);
    const summarize = (color, playerId) => {
      const moves = observations[color]; const n = moves.length;
      const count = key => moves.filter(m => m[key]).length;
      const accuracy = average(moves.map(m => m.accuracy));
      const avgLoss = average(moves.map(m => m.loss));
      const variance = n ? moves.reduce((s,m) => s + (m.accuracy-accuracy)**2,0)/n : null;
      const defended = count('successful_defense'), threatened = count('avoidable_mate');
      const skills = {
        tactical_awareness:n ? round(Math.max(0,accuracy-100*count('missed_mate')/n)) : null,
        calculation:n ? round(100*Math.exp(-avgLoss/2)) : null,
        defense:defended+threatened ? round(100*defended/(defended+threatened)) : null,
        consistency:n ? round(Math.max(0,100-Math.sqrt(variance))) : null
      };
      const half = Math.floor(n/2); const earlier = moves.slice(0,half), later = moves.slice(half);
      const trend = earlier.length>=2 && later.length>=2 ? round(average(later.map(m=>m.accuracy))-average(earlier.map(m=>m.accuracy))) : null;
      const priorities = [
        { topic:'tactical_awareness',count:count('missed_mate'),exercise:'mate_in_one' },
        { topic:'defense',count:count('avoidable_mate'),exercise:'defend_mate_in_one' },
        { topic:'calculation',count:moves.filter(m=>['mistake','blunder'].includes(m.quality)&&!m.missed_mate&&!m.avoidable_mate).length,exercise:'candidate_moves' },
        { topic:'consistency',count:moves.filter(m=>m.quality==='inaccuracy').length,exercise:'move_review' }
      ].filter(x=>x.count).sort((a,b)=>b.count-a.count || a.topic.localeCompare(b.topic)).slice(0,3);
      const achievements = [
        {code:'delivered_checkmate',count:count('delivered_mate')},
        {code:'avoided_immediate_mate',count:defended},
        {code:'matched_heuristic_candidate',count:count('matched_candidate')},
        {code:'improved_within_match_accuracy',count:trend!==null && trend>5 ? 1:0}
      ].filter(x=>x.count);
      return {color,player_id:playerId,total_moves:n,estimated_accuracy:accuracy,average_estimated_loss:avgLoss,skills,overall_score:average(Object.values(skills).filter(x=>x!==null)),accuracy_change:trend,accuracy_trend:trend===null?'insufficient_data':trend>5?'improving':trend< -5?'declining':'stable',move_quality:Object.fromEntries(['excellent','good','inaccuracy','mistake','blunder'].map(q=>[q,moves.filter(m=>m.quality===q).length])),achievements,training_priorities:priorities,training_completed:false,observations:moves};
    };
    res.json({match:{id:match.id,status:match.status,result:match.result,game_type:match.game_type,total_moves:rr.rows.length,scope:match.status==='completed'?'completed_match':'recorded_moves_so_far'},viewer:{player_id:req.user.id,color:match.white_player_id===req.user.id?'white':'black'},white:summarize('white',match.white_player_id),black:summarize('black',match.black_player_id),analysis:{engine_verified:false,achievements_saved:false,training_sessions_tracked:false,method:'two-ply material heuristic with mate-in-one checks'},note:'Within-match heuristic estimates; no long-term training or badge persistence.'});
  } catch (e) { console.error(e); bad(res, 'Unable to retrieve coaching report.', 500); }
});

export default router;
