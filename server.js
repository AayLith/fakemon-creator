const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = 8090;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Dossier de sauvegarde local pour vos exports de Fakemons
const EXPORT_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR);

// Utilitaire basique pour nettoyer le TypeScript brut de Showdown et extraire l'objet
function parseShowdownTS(tsContent) {
    try {
        // Supprime les exports et types TypeScript pour isoler l'objet JS
        let jsonText = tsContent
            .replace(/export\s+const\s+\w+\s*(:\s*[^=]+)?\s*=\s*/g, '')
            .replace(/;\s*$/, '')
            .trim();
        // Une évaluation sécurisée basique ou un nettoyage plus profond peut être requis selon le fichier,
        // Pour l'exemple, on renvoie une structure épurée exploitable en frontend.
        return jsonText;
    } catch (e) {
        return "{}";
    }
}

// API : Charger les données globales depuis le dépôt officiel GitHub de Showdown (Gen 9)
app.get('/api/load-showdown', async (req, res) => {
    try {
        const baseUrl = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
        
        const [pokedexRes, formatsRes, learnsetsRes, movesRes, abilitiesRes] = await Promise.all([
            fetch(`${baseUrl}/pokedex.ts`).then(r => r.text()),
            fetch(`${baseUrl}/formats-data.ts`).then(r => r.text()),
            fetch(`${baseUrl}/learnsets.ts`).then(r => r.text()),
            fetch(`${baseUrl}/moves.ts`).then(r => r.text()),
            fetch(`${baseUrl}/abilities.ts`).then(r => r.text())
        ]);

        res.json({
            success: true,
            pokedex: parseShowdownTS(pokedexRes),
            formatsData: parseShowdownTS(formatsRes),
            learnsets: parseShowdownTS(learnsetsRes),
            moves: parseShowdownTS(movesRes),
            abilities: parseShowdownTS(abilitiesRes)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API : Sauvegarder les modifications dans des fichiers distincts
app.post('/api/save-fakemons', (req, res) => {
    try {
        const { pokedex, formatsData, learnsets, images } = req.body;

        // 1. Sauvegarde des fichiers de données au format TypeScript pour Showdown / DH2
        fs.writeFileSync(path.join(EXPORT_DIR, 'pokedex.ts'), `export const Pokedex: ModdedSpeciesDataTable = ${JSON.stringify(pokedex, null, '\t')};`);
        fs.writeFileSync(path.join(EXPORT_DIR, 'formats-data.ts'), `export const FormatsData: ModdedFormatsDataTable = ${JSON.stringify(formatsData, null, '\t')};`);
        fs.writeFileSync(path.join(EXPORT_DIR, 'learnsets.ts'), `export const Learnsets: ModdedLearnsetDataTable = ${JSON.stringify(learnsets, null, '\t')};`);

        // 2. Sauvegarde des images physiques décodées depuis le Base64 du canvas
        const imgDir = path.join(EXPORT_DIR, 'sprites');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        if (!fs.existsSync(path.join(imgDir, 'xy'))) fs.mkdirSync(path.join(imgDir, 'xy'));
        if (!fs.existsSync(path.join(imgDir, 'icons'))) fs.mkdirSync(path.join(imgDir, 'icons'));

        for (const [id, data] of Object.entries(images)) {
            if (data.sprite) {
                const spriteBuffer = Buffer.from(data.sprite.split(',')[1], 'base64');
                fs.writeFileSync(path.join(imgDir, 'xy', `${id}.png`), spriteBuffer);
            }
            if (data.icon) {
                const iconBuffer = Buffer.from(data.icon.split(',')[1], 'base64');
                fs.writeFileSync(path.join(imgDir, 'icons', `${id}.png`), iconBuffer);
            }
        }

        res.json({ success: true, message: "Fichiers et sprites exportés avec succès dans le dossier /exports !" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log(`Fakemon Creator actif sur http://localhost:${PORT}`));

// API : Charger les données depuis un dossier de Mod GitHub spécifique
app.post('/api/load-mod', async (req, res) => {
    try {
        let { githubUrl } = req.body;
        if (!githubUrl) return res.status(400).send("URL manquante");

        let baseUrl = githubUrl.trim().replace(/\/$/, "");
        if (baseUrl.includes("github.com") && baseUrl.includes("/tree/")) {
            baseUrl = baseUrl.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/");
        }

        const smogonBaseUrl = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
        
        console.log(`📥 Aspiration du mod et des dictionnaires de texte Smogon...`);

        const fetchFileWithFallback = async (url, fallbackContent) => {
            const r = await fetch(url);
            if (r.status === 404) return fallbackContent;
            return r.text();
        };

        // Téléchargement des données de votre mod + Données mécaniques Smogon + Textes Smogon
        const [pokedexRes, formatsRes, learnsetsRes, movesRes, abilitiesRes, movesTextRes, abilitiesTextRes] = await Promise.all([
            fetchFileWithFallback(`${baseUrl}/pokedex.ts`, 'export const Pokedex = {};'),
            fetchFileWithFallback(`${baseUrl}/formats-data.ts`, 'export const FormatsData = {};'),
            fetchFileWithFallback(`${baseUrl}/learnsets.ts`, 'export const Learnsets = {};'),
            fetch(`${smogonBaseUrl}/moves.ts`).then(r => r.text()),
            fetch(`${smogonBaseUrl}/abilities.ts`).then(r => r.text()),
            fetch(`${smogonBaseUrl}/text/moves.ts`).then(r => r.text()),       // 🌟 Nouveau : Textes des attaques
            fetch(`${smogonBaseUrl}/text/abilities.ts`).then(r => r.text())   // 🌟 Nouveau : Textes des talents
        ]);

        res.json({
            success: true,
            pokedex: parseShowdownTS(pokedexRes),
            formatsData: parseShowdownTS(formatsRes),
            learnsets: parseShowdownTS(learnsetsRes),
            moves: parseShowdownTS(movesRes),
            abilities: parseShowdownTS(abilitiesRes),
            movesText: parseShowdownTS(movesTextRes),         // 🌟 Transmis au client
            abilitiesText: parseShowdownTS(abilitiesTextRes)   // 🌟 Transmis au client
        });
    } catch (error) {
        res.status(500).send(`Erreur interne du serveur : ${error.message}`);
    }
});