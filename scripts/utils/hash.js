import crypto from 'node:crypto';

export function sha1(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}