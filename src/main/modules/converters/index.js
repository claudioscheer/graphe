/**
 * Converter registry — public API for converting module files to MyBible SQLite3.
 */
const path = require('path');
const thewordConverter = require('./theword-converter');
const myswordConverter = require('./mysword-converter');

// Registry: extension → converter module
const converters = {
  '.ont': thewordConverter,
  '.ontx': thewordConverter,
  '.nt': thewordConverter,
  '.ntx': thewordConverter,
  '.ot': thewordConverter,
  '.otx': thewordConverter,
  '.twm': thewordConverter,
  '.mybible': myswordConverter,
};

function getSupportedExtensions() {
  return Object.keys(converters);
}

async function convertFile(inputPath, outputDir, onProgress) {
  const basename = path.basename(inputPath).toLowerCase();

  // Handle compound extensions (.bbl.mybible, .dct.mybible)
  if (basename.endsWith('.bbl.mybible') || basename.endsWith('.dct.mybible')) {
    return myswordConverter.convert(inputPath, outputDir, onProgress);
  }

  const ext = path.extname(inputPath).toLowerCase();
  const converter = converters[ext];
  if (!converter) throw new Error(`Unsupported format: ${ext}`);
  return converter.convert(inputPath, outputDir, onProgress);
}

module.exports = { convertFile, getSupportedExtensions };
