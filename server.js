require('dotenv').config();
const express = require('express');
const sql = require('mssql/msnodesqlv8');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const config = {
    database: process.env.DB_NAME || 'CinemaDB',
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    driver: 'msnodesqlv8',
    options: {
        trustedConnection: true,
        trustServerCertificate: true
    }
};

// Gestionare Pool de Conexiuni (Singleton)
let poolPromise = sql.connect(config)
    .then(pool => {
        console.log('Conectat la SQL Server');
        return pool;
    })
    .catch(err => {
        console.error('Eroare la conectare DB:', err);
        process.exit(1);
    });

// ---------------- LOGIN -------------------
app.post('/login', async (req, res) => {
    const { nume, rmail } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('n', sql.NVarChar, nume)
            .input('r', sql.NVarChar, rmail)
            .query("SELECT Id_client FROM Clienti WHERE Nume=@n AND Rmail=@r");

        if (result.recordset.length === 0) {
            return res.send("<h1>Date greșite!</h1><a href='/login.html'>Înapoi</a>");
        }

        const client = result.recordset[0];
        // Redirecționăm cu ID-ul în URL
        return res.redirect(`/home.html?id_client=${client.Id_client}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Eroare server la login!");
    }
});

// ---------------- LISTĂ FILME -------------------
// ---------------- LISTĂ FILME (CU POZE DIN FOLDERUL LOCAL) -------------------
app.get('/api/filme', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT * FROM Filme");
        
        // Mapăm rezultatele pentru a ne asigura că fiecare film are poza corectă
        const filmeCuPoze = result.recordset.map(film => {
            // Eliminăm spațiile din titlu pentru a se potrivi cu numele fișierelor tale
            // Exemplu: "The Batman" devine "TheBatman.png"
            let numePoza = film.Titlu.replace(/\s+/g, '') + ".png";
            
            return {
                ...film,
                Poza: `poze/${numePoza}` // Construim calea către folderul tău
            };
        });

        res.json(filmeCuPoze);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Eroare la preluarea filmelor" });
    }
});
// ---------------- DETALII FILM + SĂLI -------------------
app.get('/api/film/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const pool = await poolPromise;
        const film = await pool.request()
            .input("id", sql.Int, id)
            .query("SELECT * FROM Filme WHERE Id_film=@id");

        const sali = await pool.request()
            .input("id", sql.Int, id)
            .query(`
                SELECT fs.Id_film_sala, s.Id_sala, s.NumeSala, s.Capacitate, fs.Tip_film
                FROM Film_Sala fs
                JOIN Sali s ON fs.Id_sala = s.Id_sala
                WHERE fs.Id_film=@id
            `);

        res.json({ film: film.recordset[0], sali: sali.recordset });
    } catch (err) {
        res.status(500).json({ error: "Eroare detalii film" });
    }
});

// ---------------- LOCURI PENTRU FILM + SALĂ -------------------
app.get('/api/locuri_film/:id_film_sala', async (req, res) => {
    const id_film_sala = req.params.id_film_sala;
    try {
        const pool = await poolPromise;

        const salaInfo = await pool.request()
            .input('id', sql.Int, id_film_sala)
            .query(`SELECT Id_sala FROM Film_Sala WHERE Id_film_sala=@id`);

        if(!salaInfo.recordset[0]) return res.status(404).json({ error:"Sala nu exista" });
        const id_sala = salaInfo.recordset[0].Id_sala;

        const locuri = await pool.request()
            .input('id_sala', sql.Int, id_sala)
            .query(`SELECT Id_loc, Rand, Numar FROM Locuri WHERE Id_sala=@id_sala ORDER BY Rand, Numar`);

        const ocupate = await pool.request()
            .input('id_fs', sql.Int, id_film_sala)
            .query(`
                SELECT b.Id_loc
                FROM Bilete b
                JOIN Rezervari r ON b.Id_rezervare = r.Id_rezervare
                WHERE r.Id_film_sala=@id_fs AND r.Status='Activa'
            `);

        const ocupateIds = ocupate.recordset.map(o => o.Id_loc);
        const rezultat = locuri.recordset.map(l => ({
            ...l,
            Ocupat: ocupateIds.includes(l.Id_loc)
        }));

        res.json(rezultat);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Eroare locuri" });
    }
});

// ---------------- ADAUGĂ REZERVARE (CORECȚIE CHEIE) -------------------
// ---------------- ADAUGĂ REZERVARE (CORECȚIE TIP DATE) -------------------
app.post('/api/rezerva', async (req, res) => {
    const { id_client, id_film_sala, id_loc } = req.body;

    if(!id_client || !id_film_sala || !id_loc){
        return res.status(400).json({ success:false, error:"Date incomplete" });
    }

    try {
        const pool = await poolPromise;
        
        // 1. Inserăm rezervarea
        const rezQuery = await pool.request()
            .input("id_fs", sql.Int, id_film_sala)
            .input("id_c", sql.Int, id_client)
            .query(`
                INSERT INTO Rezervari (Id_film_sala, Data_rezervare, Status, Id_client)
                VALUES (@id_fs, GETDATE(), 'Activa', @id_c);
                SELECT SCOPE_IDENTITY() AS Id;
            `);

        const id_rez = rezQuery.recordset[0].Id;

        // 2. Inserăm biletul - CORECȚIE: Folosim codul ca String explicit
        // Verifică în SQL: ALTER TABLE Bilete ALTER COLUMN Cod_bilet NVARCHAR(50);
        const codGenerat = `BIL-${id_rez}-${id_loc}`;

        await pool.request()
            .input("id_rez", sql.Int, id_rez)
            .input("id_loc", sql.Int, id_loc)
            .input("cod", sql.NVarChar, codGenerat) // Forțăm tipul NVarChar
            .query(`
                INSERT INTO Bilete (Id_rezervare, Id_loc, Pret, Cod_bilet)
                VALUES (@id_rez, @id_loc, 30, @cod)
            `);

        res.json({ success: true, id_rezervare: id_rez });
    } catch (err) {
        console.error("Eroare la rezervare:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------- REZERVĂRILE MELE -------------------
app.get('/api/rezervarile_mele/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT r.Id_rezervare, f.Titlu, s.NumeSala, r.Data_rezervare, r.Status,
                       l.Rand, l.Numar, b.Cod_bilet
                FROM Rezervari r
                JOIN Film_Sala fs ON r.Id_film_sala = fs.Id_film_sala
                JOIN Filme f ON fs.Id_film = f.Id_film
                JOIN Sali s ON fs.Id_sala = s.Id_sala
                JOIN Bilete b ON b.Id_rezervare = r.Id_rezervare
                JOIN Locuri l ON b.Id_loc = l.Id_loc
                WHERE r.Id_client=@id
                ORDER BY r.Data_rezervare DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: "Eroare istoric rezervari" });
    }
});

// ---------------- PROFIL CLIENT -------------------
app.get('/api/client/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query("SELECT Id_client, Nume, Rmail, Telefon FROM Clienti WHERE Id_client=@id");
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: "Eroare profil" });
    }
});

// ---------------- ANULARE REZERVARE (VERSIUNEA STABILĂ) -------------------
app.delete('/api/anuleaza_rezervare/:id_rezervare', async (req, res) => {
    const id_rez = req.params.id_rezervare;
    
    if (!id_rez) {
        return res.status(400).json({ success: false, error: "ID rezervare lipsă" });
    }

    try {
        const pool = await poolPromise;
        
        // Folosim o tranzacție pentru a fi siguri că ștergem ambele înregistrări corect
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            // Pasul 1: Ștergem din tabela Bilete (unde Id_rezervare este cheie străină)
            await request
                .input('id_rez', sql.Int, id_rez)
                .query("DELETE FROM Bilete WHERE Id_rezervare = @id_rez");

            // Pasul 2: Ștergem din tabela Rezervari
            await request
                .input('id_rez_2', sql.Int, id_rez)
                .query("DELETE FROM Rezervari WHERE Id_rezervare = @id_rez_2");

            await transaction.commit();
            res.json({ success: true, message: "Rezervare și bilet eliminate cu succes" });
            
        } catch (err) {
            await transaction.rollback();
            throw err; // Aruncăm eroarea mai departe pentru a fi prinsă de catch-ul exterior
        }

    } catch (err) {
        console.error("Eroare SQL la anulare:", err.message);
        res.status(500).json({ 
            success: false, 
            error: "Eroare SQL: " + err.message 
        });
    }
});
app.get('/', (req,res) => res.redirect('/login.html'));
const PORT = 3000;
app.listen(PORT, () => console.log(`Server activ la: http://localhost:${PORT}`));
