function audioExtension(contentType, url = '') {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const known = { 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'audio/opus': '.opus', 'audio/aac': '.aac', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3' };
  if (known[mime]) return known[mime];
  try { const ext = require('node:path').extname(new URL(url).pathname).toLowerCase(); if (['.mp3','.flac','.wav','.ogg','.opus','.aac','.m4a','.ape','.wv'].includes(ext)) return ext; } catch {}
  return '.mp3';
}
module.exports = { audioExtension };
