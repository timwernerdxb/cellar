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

    // Common Spanish/Portuguese words with accented characters that appear in wine/spirits
    // Map corrupted patterns (where accented char became \uFFFD) back to correct text
    const REPLACEMENTS = [
      // í patterns
      ['D\uFFFDa', 'Día'],
      ['d\uFFFDa', 'día'],
      ['M\uFFFDsica', 'Música'],
      ['m\uFFFDsica', 'música'],
      ['Cl\uFFFDsico', 'Clásico'],
      ['cl\uFFFDsico', 'clásico'],
      ['Ed\uFFFDci\uFFFDn', 'Edición'],
      ['edici\uFFFDn', 'edición'],
      ['Colecci\uFFFDn', 'Colección'],
      ['colecci\uFFFDn', 'colección'],
      ['A\uFFFDejo', 'Añejo'],
      ['a\uFFFDejo', 'añejo'],
      ['Espa\uFFFDol', 'Español'],
      ['espa\uFFFDol', 'español'],
      ['Se\uFFFDor', 'Señor'],
      ['se\uFFFDor', 'señor'],
      ['Oto\uFFFDo', 'Otoño'],
      ['oto\uFFFDo', 'otoño'],
      ['Ni\uFFFDo', 'Niño'],
      ['ni\uFFFDo', 'niño'],
      ['Cumplea\uFFFDos', 'Cumpleaños'],
      ['Sue\uFFFDo', 'Sueño'],
      ['Due\uFFFDo', 'Dueño'],
      ['Peque\uFFFDo', 'Pequeño'],
      ['Pi\uFFFDa', 'Piña'],
      ['Caba\uFFFDa', 'Cabaña'],
      ['Monta\uFFFDa', 'Montaña'],
      ['Compa\uFFFD\uFFFDa', 'Compañía'],
      ['Compa\uFFFDia', 'Compañía'],
      ['Viña', 'Viña'],  // already correct but include for completeness
      ['Vi\uFFFDa', 'Viña'],
      ['Crianza', 'Crianza'],
      ['Reserva', 'Reserva'],
      ['Sat\uFFFDn', 'Satén'],
      ['Caf\uFFFD', 'Café'],
      ['Ros\uFFFD', 'Rosé'],
      ['Cuv\uFFFDe', 'Cuvée'],
      ['cuv\uFFFDe', 'cuvée'],
      ['Brut\uFFFD', 'Bruté'],
      ['Premi\uFFFDre', 'Première'],
      ['Ch\uFFFDteau', 'Château'],
      ['ch\uFFFDteau', 'château'],
      ['C\uFFFDtes', 'Côtes'],
      ['c\uFFFDtes', 'côtes'],
      ['R\uFFFDserve', 'Réserve'],
      ['r\uFFFDserve', 'réserve'],
      ['Cuv\uFFFDe', 'Cuvée'],
      ['Mill\uFFFDsime', 'Millésime'],
      ['Premi\uFFFDr', 'Premiér'],
      ['Cr\uFFFDmant', 'Crémant'],
      ['S\uFFFDlection', 'Sélection'],
      ['G\uFFFDn\uFFFDrique', 'Générique'],
      // Single replacement character surrounded by word boundaries - best-effort fixes
      ['Mu\uFFFDrte', 'Muérte'],
      ['mu\uFFFDrte', 'muérte'],
      ['Muertos', 'Muertos'], // already correct
      ['M\uFFFDxico', 'México'],
      ['m\uFFFDxico', 'méxico'],
      ['Jalape\uFFFDo', 'Jalapeño'],
      ['jalape\uFFFDo', 'jalapeño'],
      ['Ag\uFFFDve', 'Agáve'],  // sometimes written with accent
      ['Gonz\uFFFDlez', 'González'],
      ['Guti\uFFFDrrez', 'Gutiérrez'],
      ['Ram\uFFFDrez', 'Ramírez'],
      ['Mart\uFFFDnez', 'Martínez'],
      ['Hern\uFFFDndez', 'Hernández'],
      ['L\uFFFDpez', 'López'],
      ['P\uFFFDrez', 'Pérez'],
      ['Garc\uFFFDa', 'García'],
      ['Jim\uFFFDnez', 'Jiménez'],
      ['Dom\uFFFDnguez', 'Domínguez'],
      ['Rodr\uFFFDguez', 'Rodríguez'],
      ['Fern\uFFFDndez', 'Fernández'],
      ['S\uFFFDnchez', 'Sánchez'],
      ['N\uFFFD\uFFFDez', 'Núñez'],
      ['Ib\uFFFD\uFFFDez', 'Ibáñez'],
      ['Ord\uFFFD\uFFFDez', 'Ordóñez'],
      ['Mu\uFFFDoz', 'Muñoz'],
      // Catalan/Italian wine terms
      ['Regin\uFFFD', 'Reginó'],
      ['Barbar\uFFFDsco', 'Barbarésco'],
    ];

    // Process all three data tables
    const tables = ['bottles', 'tastings', 'finds'];
    let totalFixed = 0;

    for (const table of tables) {
      // Find rows that contain the replacement character
      const result = await pool.query(
        `SELECT id, user_id, data FROM ${table} WHERE data::text LIKE '%\uFFFD%'`
      );

      for (const row of result.rows) {
        let dataStr = JSON.stringify(row.data);
        let changed = false;

        for (const [bad, good] of REPLACEMENTS) {
          if (dataStr.includes(bad)) {
            dataStr = dataStr.split(bad).join(good);
            changed = true;
          }
        }

        // Also do a final pass: any remaining lone \uFFFD between two lowercase letters
        // is likely a missing accented vowel — we can't auto-fix those without context,
        // but log them
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
        // Extract words around the replacement character
        const matches = dataStr.match(/\w{0,10}\uFFFD\w{0,10}/g);
        if (matches) remainingExamples.push(...matches.slice(0, 3));
      }
    }

    res.json({
      ok: true,
      fixed: totalFixed,
      remaining,
      remainingExamples: remainingExamples.slice(0, 10),
    });
  } catch (err) {
    console.error('Fix encoding error:', err);
    res.status(500).json({ error: 'Failed to fix encoding' });
  }
});

module.exports = router;
