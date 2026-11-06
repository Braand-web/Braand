import assert from 'node:assert/strict';
import test from 'node:test';
import {signPreview, verifyPreview, previewCookie, PREVIEW_COOKIE} from '../lib/preview-token.mjs';

const secret = 'a'.repeat(64), sandbox = 'f'.repeat(40);
test('a preview link opens one sandbox port until it expires, and cannot be forged', async () => {
  const token = await signPreview({sandbox, port: 3000, expiresAt: Date.now() + 60000}, secret);
  assert.deepEqual(await verifyPreview(token, secret).then(v => v && {s: v.sandbox, p: v.port}), {s: sandbox, p: 3000});
  assert.equal(await verifyPreview(token, 'b'.repeat(64)), null, 'another secret');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({s: 'e'.repeat(40), p: 3000, e: Date.now() + 60000})).toString('base64url') + '.' + signature;
  assert.equal(await verifyPreview(forged, secret), null, 'another sandbox with the same signature');
  assert.equal(await verifyPreview(payload + '.' + signature + '.x', secret), null);
  assert.equal(await verifyPreview(await signPreview({sandbox, port: 3000, expiresAt: Date.now() - 1}, secret), secret), null, 'expired');
  await assert.rejects(() => signPreview({sandbox, port: 3000}, 'short'), /secret/);
  await assert.rejects(() => signPreview({sandbox: 'x', port: 3000}, secret), /invalid/);
  await assert.rejects(() => signPreview({sandbox, port: 80}, secret), /invalid/);
});

test('the preview cookie is read among others', () => {
  const request = new Request('https://x', {headers: {cookie: `theme=dark; ${PREVIEW_COOKIE}=abc.def; other=1`}});
  assert.equal(previewCookie(request), 'abc.def');
  assert.equal(previewCookie(new Request('https://x')), null);
});
