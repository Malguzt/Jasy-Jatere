const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createCameraCredentialCipher,
    CREDENTIAL_PREFIX
} = require('../src/security/camera-credential-cipher');

test('camera credential cipher encrypts and decrypts values when enabled', () => {
    const cipher = createCameraCredentialCipher({
        masterKey: 'unit-test-master-key'
    });

    const encrypted = cipher.encrypt('secret-pass');
    assert.ok(typeof encrypted === 'string');
    assert.ok(encrypted.startsWith(`${CREDENTIAL_PREFIX}:`));

    const decrypted = cipher.decrypt(encrypted);
    assert.equal(decrypted, 'secret-pass');
});

test('camera credential cipher is no-op when master key is missing', () => {
    const cipher = createCameraCredentialCipher({
        masterKey: ''
    });

    assert.equal(cipher.isEnabled(), false);
    assert.equal(cipher.encrypt('secret-pass'), null);
    assert.equal(cipher.decrypt('enc:v1:x:y:z'), null);
});
