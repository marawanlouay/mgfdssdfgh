import pg from 'pg';
import 'dotenv/config';
if (!process.env.DATABASE_URL) console.warn('DATABASE_URL missing: configure .env before database requests.');
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false},max:5,connectionTimeoutMillis:10000});
