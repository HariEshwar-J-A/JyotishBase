# JyotishBase
*By Harieshwar Jagan Abirami*

The data behind the astrological mind of HoraMind - an AI powered super astrologer. 

JyotishBase is a comprehensive standard dataset for Vedic Astrology, designed for researchers, AI developers, and astrologers wanting to build RAG (Retrieval-Augmented Generation) databases or train their own models. It comprises cleaned astrological texts, a structured metadata taxonomy, and scripts designed specifically for ingesting astrological data into a vector database (ChromaDB) locally.

## 🚀 Usage

### 1. Prerequisites
- Node.js installed on your system.
- Basic understanding of running Node scripts.

### 2. Installation
Ensure you clone the repository and then install the necessary dependencies via npm:
```bash
git clone https://github.com/HariEshwar-J-A/JyotishBase.git
cd JyotishBase
npm install
# or
npm run setup
```

### 3. Ingestion & Database Creation
To build the vector database with the curated astrological texts (such as Santhanam's translation of BPHS), simply run:
```bash
npm run injest
```
> Note: The vector database output will be stored locally in an ignored `chroma_data/` folder to prevent bloating the source repository.

### 4. Querying
You can test out retrieval queries on the newly built ChromaDB database by running:
```bash
npm run query
```

## ⚠️ Limitations

1. **Static Data**: The embeddings are processed against specific subsets of astrological texts provided within the repository.
2. **Translation Variances**: Vedic astrology contains nuances that vary depending on author and translation; the queries represent the specific meaning encoded in the provided raw texts (currently Santhanam translations).
3. **Local Storage**: The database uses a local ChromaDB instance meant for research and building initial RAG prototypes. It is not currently configured for cloud or concurrent production scaling out-of-the-box.

## 🔮 Future Scope

- **Expanded Library**: Ingesting additional foundational texts such as *Sharma* translations, *Phaladeepika*, *Jataka Parijata*, etc.
- **Improved Chunking**: Developing highly specialized astrological semantic chunking methods optimized for identifying complex rule intersections and planetary combinations (Yogas).
- **Multi-lingual Support**: Structuring metadata around Sanskrit terminology to map seamlessly between original slokas and English translations.
- **Finetuning Data Preparation**: Exporting curated query-response pairs from the database to facilitate direct LLM parameter fine-tuning.

## ⚖️ Licensing

This repository and its contents (data, scripts, architecture) are made available strictly for **non-commercial, academic, and personal use** under the [CC BY-NC 4.0 License](LICENSE). 

If you intend to use this dataset, its generated embeddings, or its architecture to power a commercial product, SaaS application, or any revenue-generating service, you **must purchase a Commercial License**. Please refer to the [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) file for more information.

## 🌌 Other Related Projects

If you are building astrological tools, you should absolutely check out our other projects:

- [**HoraMind**](https://github.com/HariEshwar-J-A/HoraMind): The actual application that users interact with. It's an OpenClaw-powered Telegram AI Agent that acts as a super astrologer. It seamlessly integrates the OpenClaw framework, custom tools, the `node-jhora` math engine, and intelligent LLM routing logic to provide interactive astrological consultations.
- [**Node-Jhora**](https://github.com/HariEshwar-J-A/node-jhora): A highly accurate, modular, and open-source TypeScript calculation engine for Vedic Astrology. It provides robust calculations for planetary positions, Dasha systems, divisional charts (Vargas), Shadbala, and more, effectively acting as the mathematical backend for any Jyotish application.
