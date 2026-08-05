const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configurazione avanzata del pool per ambienti Cloud (Render / Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessario per validare il certificato SSL di Supabase nel cloud
  },
  connectionTimeoutMillis: 10000, // Timeout di 10 secondi per evitare blocchi infiniti
  idleTimeoutMillis: 30000
});

// Test di verifica connessione all'avvio
pool.connect((err, client, release) => {
  if (err) {
    console.error('Errore critico di connessione al database:', err.stack);
  } else {
    console.log('Connessione al database stabilita con successo!');
    release();
  }
});

// GET: Tutte le proposte
app.get('/api/proposals', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proposals ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Errore query proposals:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST: Crea una proposta
app.post('/api/proposals', async (req, res) => {
  const { creator_id, title, description, pdf_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO proposals (creator_id, title, description, pdf_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [creator_id, title, description, pdf_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Errore inserimento proposal:', err);
    res.status(500).json({ error: 'Errore durante la creazione della proposta' });
  }
});

// POST: Invia candidatura
app.post('/api/applications', async (req, res) => {
  const { proposal_id, user_id } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO applications (proposal_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING *",
      [proposal_id, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Errore inserimento application:', err);
    res.status(400).json({ error: 'Candidatura già esistente o errore nei dati' });
  }
});

// GET: Candidati per una proposta
app.get('/api/proposals/:id/candidates', async (req, res) => {
  const proposalId = req.params.id;
  try {
    const result = await pool.query(
      `SELECT a.id, a.status, u.name as user_name, u.email as user_email 
       FROM applications a 
       JOIN users u ON a.user_id = u.id 
       WHERE a.proposal_id = $1`,
      [proposalId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Errore recupero candidati:', err);
    res.status(500).json({ error: 'Errore nel recupero dei candidati' });
  }
});

// PATCH: Approva candidatura con regola di esclusività
app.patch('/api/applications/:id/approve', async (req, res) => {
  const applicationId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const appResult = await client.query(
      `SELECT a.user_id, a.proposal_id FROM applications a WHERE a.id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Candidatura non trovata.' });
    }

    const { user_id } = appResult.rows[0];

    await client.query(
      `UPDATE applications SET status = 'accepted' WHERE id = $1`,
      [applicationId]
    );

    await client.query(
      `DELETE FROM applications WHERE user_id = $1 AND id != $2 AND status = 'pending'`,
      [user_id, applicationId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Candidatura accettata e altre candidature pendenti rimosse con successo.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore approvazione:', err);
    res.status(500).json({ error: "Errore durante l'approvazione" });
  } finally {
    client.release();
  }
});

// Configurazione porta richiesta da Render (Default 10000)
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});