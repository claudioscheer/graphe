/**
 * Converter registry — public API for converting module files to MyBible SQLite3.
 */
const path = require('path');
const thewordConverter = require('./theword-converter');

// Registry: extension → converter module
const converters = {
  '.ont': thewordConverter,
  '.ontx': thewordConverter,
  '.nt': thewordConverter,
  '.ntx': thewordConverter,
  '.ot': thewordConverter,
  '.otx': thewordConverter,
  '.twm': thewordConverter,
};

function getSupportedExtensions() {
  return Object.keys(converters);
}

async function convertFile(inputPath, outputDir, onProgress) {
  const ext = path.extname(inputPath).toLowerCase();
  const converter = converters[ext];
  if (!converter) throw new Error(`Unsupported format: ${ext}`);
  return converter.convert(inputPath, outputDir, onProgress);
}

module.exports = { convertFile, getSupportedExtensions };
