const crypto = require('crypto');

const CREDENTIAL_PREFIX = 'enc:v1';
const IV_BYTES = 12;

function deriveKey(masterKey) {
    return crypto.createHash('sha256').update(String(masterKey)).digest();
}

function parseToken(token) {
    const parts = String(token || '').split(':');
    if (parts.length !== 5) return null;
    if (`${parts[0]}:${parts[1]}` !== CREDENTIAL_PREFIX) return null;
    return {
        iv: parts[2],
        tag: parts[3],
        ciphertext: parts[4]
    };
}

function createCameraCredentialCipher({
    masterKey = process.env.CAMERA_CREDENTIALS_MASTER_KEY || ''
} = {}) {
    const normalizedMasterKey = String(masterKey || '').trim();
    const enabled = normalizedMasterKey.length > 0;
    const key = enabled ? deriveKey(normalizedMasterKey) : null;

    return {
        isEnabled() {
            return enabled;
        },
        isEncryptedValue(value) {
            return String(value || '').startsWith(`${CREDENTIAL_PREFIX}:`);
        },
        encrypt(value) {
            if (!enabled) return null;
            if (value === null || value === undefined) return null;
            const text = String(value);
            if (!text) return null;

            const iv = crypto.randomBytes(IV_BYTES);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
            const tag = cipher.getAuthTag();
            return `${CREDENTIAL_PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
        },
        decrypt(token) {
            if (!enabled) return null;
            const parsed = parseToken(token);
            if (!parsed) return null;
            try {
                const decipher = crypto.createDecipheriv(
                    'aes-256-gcm',
                    key,
                    Buffer.from(parsed.iv, 'base64url')
                );
                decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
                const plaintext = Buffer.concat([
                    decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
                    decipher.final()
                ]);
                return plaintext.toString('utf8');
            } catch (error) {
                return null;
            }
        }
    };
}

module.exports = {
    createCameraCredentialCipher,
    CREDENTIAL_PREFIX
};
