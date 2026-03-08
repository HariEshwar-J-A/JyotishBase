import { ChromaClient } from "chromadb";
import { pipeline } from "@xenova/transformers";

// 🔴 REPLACE THIS with your actual Ubuntu VM IP address
const VM_IP_ADDRESS = "192.168.128.128";
const client = new ChromaClient({ host: VM_IP_ADDRESS, port: 8000 });

// The exact same Entity Extractor to build our smart filters
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

async function searchBPHS() {
  console.log(`Connecting to database on ${VM_IP_ADDRESS}...`);
  const generateEmbeddings = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );
  const collection = await client.getCollection({
    name: "santhanam_source_of_truth",
  });

  // The test question
  const question = "What are the effects of Rahu in the 9th house?";
  console.log(`\n🤔 Question: "${question}"`);

  const output = await generateEmbeddings(question, {
    pooling: "mean",
    normalize: true,
  });

  // Extract tags to build our strict filter
  const requiredTags = extractTags(question);
  const filterKeys = Object.keys(requiredTags);

  let whereClause = undefined;
  if (filterKeys.length > 1) {
    whereClause = { $and: filterKeys.map((key) => ({ [key]: true })) };
  } else if (filterKeys.length === 1) {
    whereClause = { [filterKeys[0]]: true };
  }

  console.log(
    `🔍 Applying strict metadata filter:`,
    JSON.stringify(whereClause),
  );

  const results = await collection.query({
    queryEmbeddings: [Array.from(output.data)],
    nResults: 3,
    where: whereClause,
  });

  console.log("\n✨ Precision Matches:\n");
  if (!results.documents[0] || results.documents[0].length === 0) {
    console.log("No rules found matching those exact placements.");
    return;
  }

  for (let i = 0; i < results.documents[0].length; i++) {
    console.log(`Match ${i + 1} (Source: ${results.metadatas[0][i].file}):`);
    console.log(results.documents[0][i]);
    console.log("--------------------------------------------------\n");
  }
}

searchBPHS();
