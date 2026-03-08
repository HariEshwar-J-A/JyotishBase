import { ChromaClient } from "chromadb";
import { pipeline } from "@xenova/transformers";
import fs from "fs";
import path from "path";

// 🔴 REPLACE THIS with your actual Ubuntu VM IP address
const VM_IP_ADDRESS = "192.168.128.128";
const client = new ChromaClient({ host: VM_IP_ADDRESS, port: 8000 });

// The Entity Extractor: Tags text with specific planets and houses
function extractTags(text) {
  const tags = {};
  const textLower = text.toLowerCase();

  const planets = [
    "sun",
    "moon",
    "mars",
    "mercury",
    "jupiter",
    "venus",
    "saturn",
    "rahu",
    "ketu",
  ];
  planets.forEach((p) => {
    if (textLower.includes(p)) tags[`planet_${p}`] = true;
  });

  const houses = [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "5th",
    "6th",
    "7th",
    "8th",
    "9th",
    "10th",
    "11th",
    "12th",
    "ascendant",
    "lagna",
  ];
  houses.forEach((h) => {
    if (textLower.includes(h)) {
      let houseNum = h.replace(/\D/g, "");
      if (h === "ascendant" || h === "lagna") houseNum = "1";
      if (houseNum) tags[`house_${houseNum}`] = true;
    }
  });

  return tags;
}

async function ingestSanthanam() {
  console.log(`Connecting to ChromaDB on Ubuntu VM (${VM_IP_ADDRESS})...`);
  console.log("Loading Local Embedding Model on Windows i9...");
  const generateEmbeddings = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );

  // Delete the old collection so we can start fresh with our new tags
  try {
    await client.deleteCollection({ name: "santhanam_source_of_truth" });
  } catch (e) {}
  const collection = await client.getOrCreateCollection({
    name: "santhanam_source_of_truth",
  });

  // Path points "up and over" from injest-scripts to kb-text
  const baseDir = "../kb-text";
  const subDirs = fs
    .readdirSync(baseDir)
    .filter((f) => fs.lstatSync(path.join(baseDir, f)).isDirectory());

  for (const folder of subDirs) {
    const folderPath = path.join(baseDir, folder);
    const mdFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".md"));

    for (const file of mdFiles) {
      console.log(`\n📖 Tagging & Reading ${file} using Windows CPU...`);
      const content = fs.readFileSync(path.join(folderPath, file), "utf-8");
      const chunks = content
        .split(/\n\s*\n/)
        .filter((c) => c.trim().length > 40);

      for (let i = 0; i < chunks.length; i++) {
        const textChunk = chunks[i].trim();
        const output = await generateEmbeddings(textChunk, {
          pooling: "mean",
          normalize: true,
        });

        const tags = extractTags(textChunk);

        await collection.add({
          ids: [`${file}_chunk_${i}`],
          embeddings: [Array.from(output.data)],
          metadatas: [
            {
              source: "Santhanam BPHS",
              file: file,
              ...tags,
            },
          ],
          documents: [textChunk],
        });
        if (i % 50 === 0) process.stdout.write("⭐ ");
      }
    }
  }
  console.log(
    "\n✅ Smart Ingestion Complete! Data securely beamed to Ubuntu VM.",
  );
}

ingestSanthanam();
