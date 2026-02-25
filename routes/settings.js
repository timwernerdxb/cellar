const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// Get user settings
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT openai_key FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ hasOpenaiKey: !!result.rows[0].openai_key, openaiKey: result.rows[0].openai_key || null });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update OpenAI key
router.put('/openai-key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { key } = req.body;
    await pool.query('UPDATE users SET openai_key = $1, updated_at = NOW() WHERE id = $2', [key || null, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update key error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Fix corrupted encoding (U+FFFD replacement characters) in bottle/find data
router.post('/fix-encoding', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    // Context-based single-char replacements: infer accented character from surrounding letters
    // Pattern: [before chars]\uFFFD[after chars] → replacement char
    // These cover the vast majority of Spanish/French/Portuguese wine & spirit terms
    const CONTEXT_RULES = [
      // ñ — \uFFFD between vowel+consonant contexts typical for ñ
      { before: /[Aa]$/, after: /^[oeaiu]/, char: 'ñ' },   // Año, Añejo, Cabaña
      { before: /[Ii]$/, after: /^[oae]/, char: 'ñ' },     // Niño, Viña, Piña
      { before: /[Uu]$/, after: /^[oe]/, char: 'ñ' },      // Muñoz, Muñeca
      { before: /[Ee]$/, after: /^[oa]/, char: 'ñ' },      // Señor, Señal, Pequeño
      // í
      { before: /[Dd]$/, after: /^a/, char: 'í' },          // Día
      { before: /[sc]$/, after: /^[cn]/, char: 'ó' },       // Edición, Colección
      { before: /c$/, after: /^a/, char: 'í' },              // García
      { before: /[Mm]$/, after: /^s/, char: 'ú' },          // Música
      { before: /t$/, after: /^n/, char: 'í' },              // Martínez, Gutiérrez
      { before: /m$/, after: /^n/, char: 'í' },              // Jiménez, Domínguez
      { before: /r$/, after: /^g/, char: 'í' },              // Rodríguez
      { before: /[Mm]$/, after: /^x/, char: 'é' },          // México
      // é
      { before: /[Cc]af$/, after: /^[^a-z]/, char: 'é' },   // Café (end of word)
      { before: /[Rr]os$/, after: /^[^a-z]/, char: 'é' },   // Rosé (end of word)
      { before: /[Cc]h$/, after: /^t/, char: 'â' },          // Château
      { before: /[Cc]uv$/, after: /^e/, char: 'é' },         // Cuvée
      { before: /[Cc]r$/, after: /^m/, char: 'é' },          // Crémant
      { before: /[Rr]$/, after: /^s/, char: 'é' },           // Réserve
      { before: /[Ss]$/, after: /^l/, char: 'é' },           // Sélection
      { before: /n$/, after: /^ndez/, char: 'á' },           // Fernández, Hernández
      { before: /p$/, after: /^ez/, char: 'é' },             // López, Pérez
      { before: /l$/, after: /^s/, char: 'á' },              // Clásico
      { before: /[Cc]$/, after: /^t/, char: 'ô' },           // Côtes
    ];

    // Process all three data tables
    const tables = ['bottles', 'tastings', 'finds'];
    let totalFixed = 0;

    for (const table of tables) {
      const result = await pool.query(
        `SELECT id, user_id, data FROM ${table} WHERE data::text LIKE '%\uFFFD%'`
      );

      for (const row of result.rows) {
        let dataStr = JSON.stringify(row.data);
        let changed = false;

        // Apply context-based replacements iteratively
        let prevStr;
        do {
          prevStr = dataStr;
          dataStr = dataStr.replace(
            /(.{0,15})\uFFFD(.{0,15})/,
            (match, before, after) => {
              // Try each context rule
              for (const rule of CONTEXT_RULES) {
                if (rule.before.test(before) && rule.after.test(after)) {
                  return before + rule.char + after;
                }
              }
              // Fallback: if between two letters, guess based on common patterns
              // Single \uFFFD after a vowel before consonant cluster → likely ñ
              if (/[aeiou]$/i.test(before) && /^[aeiou]/i.test(after)) {
                return before + 'ñ' + after;
              }
              // \uFFFD at end of word (before quote/comma/space) after consonant → likely é/ó
              if (/[a-z]$/i.test(before) && /^["',\s\\}]/.test(after)) {
                return before + 'é' + after;
              }
              return match; // can't determine — leave it
            }
          );
          if (dataStr !== prevStr) changed = true;
        } while (dataStr !== prevStr && dataStr.includes('\uFFFD'));

        if (changed) {
          const newData = JSON.parse(dataStr);
          await pool.query(
            `UPDATE ${table} SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
            [JSON.stringify(newData), row.id, row.user_id]
          );
          totalFixed++;
        }
      }
    }

    // Check if any rows still have replacement characters after fixes
    let remaining = 0;
    const remainingExamples = [];
    for (const table of tables) {
      const result = await pool.query(
        `SELECT id, data FROM ${table} WHERE data::text LIKE '%\uFFFD%' AND user_id = $1`,
        [req.userId]
      );
      remaining += result.rows.length;
      for (const row of result.rows) {
        const dataStr = JSON.stringify(row.data);
        const matches = dataStr.match(/.{0,12}\uFFFD.{0,12}/g);
        if (matches) remainingExamples.push(...matches.slice(0, 5));
      }
    }

    res.json({
      ok: true,
      fixed: totalFixed,
      remaining,
      remainingExamples: remainingExamples.slice(0, 15),
    });
  } catch (err) {
    console.error('Fix encoding error:', err);
    res.status(500).json({ error: 'Failed to fix encoding' });
  }
});

module.exports = router;
