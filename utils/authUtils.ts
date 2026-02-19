/**
 * Passcode-based authentication utilities.
 * API keys are XOR-encoded with the passcode so they aren't stored in plain text.
 */

// XOR-encrypted API keys (encoded with the correct passcode)
const ENCRYPTED_OPENROUTER: number[] = [24, 2, 64, 13, 19, 65, 68, 1, 31, 86, 92, 13, 95, 7, 84, 89, 11, 9, 0, 5, 90, 92, 15, 4, 81, 91, 4, 7, 1, 84, 90, 13, 9, 1, 2, 15, 80, 82, 84, 83, 13, 8, 94, 91, 82, 10, 81, 8, 4, 0, 89, 12, 95, 82, 7, 13, 83, 7, 86, 2, 83, 89, 12, 82, 86, 9, 6, 3, 10, 7, 95, 90, 11];
const ENCRYPTED_SARVAM: number[] = [24, 2, 50, 91, 18, 24, 80, 88, 81, 93, 91, 54, 24, 47, 49, 8, 98, 67, 7, 98, 12, 1, 56, 10, 88, 34, 116, 66, 64, 7, 59, 51, 95, 24, 89, 26];

/**
 * XOR-decodes an encrypted array using the given key string.
 */
function xorDecode(encrypted: number[], key: string): string {
    return encrypted
        .map((code, i) => String.fromCharCode(code ^ key.charCodeAt(i % key.length)))
        .join('');
}

/**
 * Validates a passcode by attempting to decrypt the API keys.
 * Returns the decrypted keys if the passcode is correct, or null otherwise.
 */
export function validatePasscode(passcode: string): { openRouterApiKey: string; sarvamApiKey: string } | null {
    try {
        const openRouterKey = xorDecode(ENCRYPTED_OPENROUTER, passcode);
        const sarvamKey = xorDecode(ENCRYPTED_SARVAM, passcode);

        // Validate that decrypted keys have the expected prefixes
        if (openRouterKey.startsWith('sk-or-') && sarvamKey.startsWith('sk_')) {
            return { openRouterApiKey: openRouterKey, sarvamApiKey: sarvamKey };
        }
        return null;
    } catch {
        return null;
    }
}
