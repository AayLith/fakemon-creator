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
        if (!tsContent || typeof tsContent !== 'string') return "{}";

        // 1. On cherche d'abord le signe '=' de l'assignation
        const equalIndex = tsContent.indexOf('=');
        if (equalIndex === -1) return "{}";

        // 2. Le vrai début de l'objet est la première accolade APRÈS le signe '='
        const firstBrace = tsContent.indexOf('{', equalIndex);
        const lastBrace = tsContent.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
            return "{}";
        }

        // 3. Extraction de l'objet JavaScript propre
        let jsonText = tsContent.slice(firstBrace, lastBrace + 1).trim();
        
        return jsonText;
    } catch (e) {
        console.error("Erreur lors du parsing du fichier Showdown :", e);
        return "{}";
    }
}

function toID(text) {
    return text ? text.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function parseShowdownMoves(tsContent) {
    const cleanedMoves = {};
    const moveBlocks = tsContent.split(/num:\s*/);
    
    for (let i = 1; i < moveBlocks.length; i++) {
        const s = moveBlocks[i];
        if (s.includes("isNonstandard") || s.includes("isMax:true")) continue;

        // 1. Extraction du nom original pour générer l'ID
        const nameMatch = s.match(/name:\s*['"]([^'"]+)['"]/);
        const rawName = nameMatch ? nameMatch[1] : null;
        
        // 2. Conversion à la manière de Showdown
        const id = toID(rawName); 
        if (!id) continue;

        // Extraction des autres propriétés
        const extract = (key) => {
            const start = s.indexOf(key + ":");
            if (start === -1) return null;
            const pfrom = start + key.length + 1;
            let pto = s.indexOf(',', pfrom);
            if (pto === -1 || pto - pfrom > 50) pto = s.indexOf('\n', pfrom);
            return s.substring(pfrom, pto).trim().replace(/['"]/g, '');
        };

        cleanedMoves[id] = {
            name: rawName, // On garde le nom original pour l'affichage
            type: extract('type') || "Normal",
            category: extract('category') || "Status",
            basePower: parseInt(extract('basePower')) || 0,
            accuracy: extract('accuracy') === 'true' ? true : (parseInt(extract('accuracy')) || 0)
        };
    }
    
    return JSON.stringify(cleanedMoves);
}

function parseShowdownAbilities(tsContent) {
    // 1. Isoler la chaîne entre le premier { et le dernier }
    const start = tsContent.indexOf('{');
    const end = tsContent.lastIndexOf('}');
    const content = tsContent.substring(start + 1, end);

    // 2. Découpage intelligent : on cherche chaque début d'attaque "id": {
    // On split par "}," pour obtenir chaque bloc individuellement
    const blocks = content.split(/\},\s*"/);
    const cleanedAbilities = {};

    blocks.forEach((block, index) => {
        // On nettoie le nom de l'id
        const idMatch = block.match(/"?([^"]+)"?:\s*{/);
        if (!idMatch) return;
        
        const id = idMatch[1];
        
        // On extrait juste ce qui nous intéresse dans ce bloc
        // On cherche 'type:' suivi du type
        const flMatch = block.match(/flags:\s*(\d+)/);
        
        cleanedAbilities[id] = {
            name: id,
			flags: flMatch ? flMatch[1] : "Error"
        };
    });

    return JSON.stringify(cleanedAbilities);
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
			fetchFileWithFallback(`${smogonBaseUrl}/moves.ts`, 'export const Moves = {};'),
			fetchFileWithFallback(`${smogonBaseUrl}/abilities.ts`, 'export const Abilities = {};'),
            fetch(`${smogonBaseUrl}/text/moves.ts`).then(r => r.text()),       // 🌟 Nouveau : Textes des attaques
            fetch(`${smogonBaseUrl}/text/abilities.ts`).then(r => r.text())   // 🌟 Nouveau : Textes des talents
        ]);
		// console.log(parseShowdownTS(movesRes).substring(0, 1000))

		const movesRaw = parseShowdownTS(movesRes); // Ton texte brut
		const abilitiesRaw = parseShowdownTS(abilitiesRes); // Ton texte brut

		// On transforme le texte brut en un objet "allégé" (Lightweight)
		// On ne garde que les infos nécessaires à l'UI
		try {
			/*const fullMoves = {};
			const fullAbilities = {};
			
			// On utilise une Regex pour isoler chaque bloc d'attaque 
			// Format typique dans moves.ts : "id": { ... },
			// On cible le nom de l'attaque et on extrait les infos principales
			const regex = /"([^"]+)":\s*{([^}]+)}/g;
			let match;
			
			while ((match = regex.exec(movesRaw)) !== null) {
				const id = match[1];
				const content = match[2];

				// On crée un objet simple à partir des propriétés de base
				const move = {};
				
				// Extraction manuelle des champs clés via recherche simple
				if (content.includes('accuracy:')) {
					const acMatch = content.match(/accuracy:\s*(\d+)/);
					move.accuracy = acMatch ? parseInt(acMatch[1]) : 0;
				}
				if (content.includes('basePower:')) {
					const bpMatch = content.match(/basePower:\s*(\d+)/);
					move.basePower = bpMatch ? parseInt(bpMatch[1]) : 0;
				}
				if (content.includes('category:')) {
					const catMatch = content.match(/category:\s*['"]([^'"]+)['"]/);
					move.category = catMatch ? catMatch[1] : "Error";
				}
				if (content.includes('type:')) {
					const typeMatch = content.match(/type:\s*['"]([^'"]+)['"]/);
					move.type = typeMatch ? typeMatch[1] : "Error";
				}
				if (content.includes('flags:')) {
					const flMatch = content.match(/flags:\s*(\d+)/);
					move.flags = flMatch ? flMatch[1] : "";
				}
				move.name = id; // On utilisera le text/moves.ts pour le vrai nom
				
				fullMoves[id] = move;
			}
			
			while ((match = regex.exec(abilitiesRaw)) !== null) {
				const id = match[1];
				const content = match[2];

				// On crée un objet simple à partir des propriétés de base
				const ability = {};
				
				ability.name = id; // On utilisera le text/moves.ts pour le vrai nom
				
				fullAbilities[id] = ability;
			}*/
			
			// Maintenant fullMoves est un objet JSON pur
			res.json({
				success: true,
				// moves: JSON.stringify(fullMoves),
				moves: parseShowdownMoves(movesRes),
				pokedex: parseShowdownTS(pokedexRes),
				formatsData: parseShowdownTS(formatsRes),
				learnsets: parseShowdownTS(learnsetsRes),
				// abilities: JSON.stringify(fullAbilities),
				abilities: JSON.stringify(abilitiesRes),
				movesText: parseShowdownTS(movesTextRes),         // 🌟 Transmis au client
				abilitiesText: parseShowdownTS(abilitiesTextRes)   // 🌟 Transmis au client
				// ... reste des champs
			});
		} catch (e) {
			console.error("Erreur de parsing:", e);
		}
		/*
		//console.log(movesRaw.substring(0, 100));
		console.log(cleanedMoves.substring(0, 100));

        res.json({
            success: true,
            pokedex: parseShowdownTS(pokedexRes),
            formatsData: parseShowdownTS(formatsRes),
            learnsets: parseShowdownTS(learnsetsRes),
			moves: JSON.stringify(fullMoves),
			abilities: JSON.stringify(cleanedabilities), // Maintenant c'est du JSON pur et léger
            movesText: parseShowdownTS(movesTextRes),         // 🌟 Transmis au client
            abilitiesText: parseShowdownTS(abilitiesTextRes)   // 🌟 Transmis au client
        });*/
    } catch (error) {
        res.status(500).send(`Erreur interne du serveur : ${error.message}`);
    }
});